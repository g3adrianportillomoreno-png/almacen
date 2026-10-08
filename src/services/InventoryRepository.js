import { supabase } from '../utils/supabaseClient.js';
import { ChecklistModel } from '../models/ChecklistModel.js';
import { WarehouseMapModel } from '../models/WarehouseMapModel.js';

const STORAGE_KEY = 'cdm_warehouse_metadata_v1';
const MAP_KEY = 'cdm_warehouse_map_layout_v1';

/**
 * Repositorio Central de Datos (Patrón Repository)
 * Gestiona la sincronización transparente entre Supabase y la capa de almacenamiento local.
 * Es tolerante a fallos si las nuevas columnas de BD aún no han sido migradas.
 */
export class InventoryRepository {
  /**
   * Lee la caché local de metadatos (filas asignadas, estados de consulta/baja, folios)
   */
  static getMetadataCache() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return { serials: {}, checklists: {} };
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { serials: {}, checklists: {} };
      return JSON.parse(raw);
    } catch {
      return { serials: {}, checklists: {} };
    }
  }

  /**
   * Guarda en la caché local de metadatos
   */
  static saveMetadataCache(cache) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      }
    } catch (e) {
      console.warn('No se pudo guardar caché local de metadatos:', e);
    }
  }

  /**
   * Carga todos los checklists desde Supabase combinando los datos y modelos de dominio
   */
  static async fetchAllChecklists() {
    const { data, error } = await supabase
      .from('checklists')
      .select(`
        id, name, created_at, status,
        expected_series (id, checklist_id, serial_number, material_model, is_scanned, scanned_at, warehouse_name, warehouse_row, warehouse_space, internal_number, printer_status, assigned_at),
        unexpected_logs (id, scanned_value, created_at)
      `)
      .order('created_at', { ascending: false })
      .limit(10000, { foreignTable: 'expected_series' });

    if (error) {
      console.error('Error al obtener checklists desde Supabase:', error);
      throw error;
    }

    const metadataCache = this.getMetadataCache();

    // Mapear cada registro de BD al modelo ChecklistModel
    return (data || []).map((dbBatch, index) => 
      ChecklistModel.fromDb(dbBatch, index, metadataCache)
    );
  }

  /**
   * Crea un nuevo Checklist con su número consecutivo de inventario
   */
  static async createChecklist(fileName, series, consecutiveNumber) {
    const rawVal = String(consecutiveNumber || '').trim();
    const consecutive = rawVal || '1';
    const numVal = parseInt(rawVal, 10);
    const folio = ChecklistModel.formatFolio(consecutive);
    const cleanFileName = fileName.replace(/\.[^/.]+$/, '');
    const fullName = `[${folio}] Lote: ${cleanFileName}`;

    // Intentar insertar con las nuevas columnas; si fallan, insertar solo con name y status
    let batchData = null;
    let batchError = null;

    try {
      const res = await supabase
        .from('checklists')
        .insert({
          name: fullName,
          status: 'pending',
          consecutive_number: isNaN(numVal) ? null : numVal,
          folio: folio
        })
        .select()
        .single();

      batchData = res.data;
      batchError = res.error;
    } catch (err) {
      batchError = err;
    }

    // Si falló por columnas inexistentes, reintentar formato base estándar
    if (batchError) {
      const fallbackRes = await supabase
        .from('checklists')
        .insert({
          name: fullName,
          status: 'pending'
        })
        .select()
        .single();

      if (fallbackRes.error) {
        throw new Error(`Error en base de datos: ${fallbackRes.error.message}`);
      }
      batchData = fallbackRes.data;
    }

    // Guardar en caché de folios y números internos detectados del Excel
    const cache = this.getMetadataCache();
    cache.checklists = cache.checklists || {};
    cache.checklists[batchData.id] = { consecutive, folio };
    cache.serials = cache.serials || {};
    for (const s of series) {
      if (s.internalNumber) {
        cache.serials[s.serial] = {
          ...(cache.serials[s.serial] || {}),
          internalNumber: s.internalNumber
        };

        // Reconciliación automática: actualizar el número de equipo en registros previos si ya existían
        const numVal = !isNaN(Number(s.internalNumber)) ? Number(s.internalNumber) : null;
        if (numVal !== null) {
          supabase
            .from('expected_series')
            .update({ internal_number: numVal })
            .eq('serial_number', s.serial)
            .then(() => {})
            .catch(() => {});
        }
      }
    }
    this.saveMetadataCache(cache);

    // Insertar series esperadas con internal_number si viene del Excel
    const seriesToInsert = series.map(s => ({
      checklist_id: batchData.id,
      serial_number: s.serial,
      material_model: s.material,
      internal_number: s.internalNumber && !isNaN(Number(s.internalNumber)) ? Number(s.internalNumber) : null,
      is_scanned: false
    }));

    try {
      const { error: seriesError } = await supabase
        .from('expected_series')
        .insert(seriesToInsert);

      if (seriesError) {
        // Fallback si la columna internal_number aún no existe en Supabase
        const fallbackSeries = series.map(s => ({
          checklist_id: batchData.id,
          serial_number: s.serial,
          material_model: s.material,
          is_scanned: false
        }));
        await supabase.from('expected_series').insert(fallbackSeries);
      }
    } catch {
      const fallbackSeries = series.map(s => ({
        checklist_id: batchData.id,
        serial_number: s.serial,
        material_model: s.material,
        is_scanned: false
      }));
      await supabase.from('expected_series').insert(fallbackSeries);
    }

    return batchData;
  }

  /**
   * Actualiza el escaneo de una serie: la marca como completada, asigna su Fila y su Número de Inventario asignado por el operador
   */
  static async registerScan(checklistId, serialNumber, warehouseRow = 'Fila 1', internalNumber = null) {
    const serial = serialNumber.trim().toUpperCase();
    const row = warehouseRow || 'Fila 1';

    // 1. Guardar en caché local
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    cache.serials[serial] = {
      ...(cache.serials[serial] || {}),
      warehouseRow: row,
      internalNumber: internalNumber !== null && internalNumber !== undefined ? internalNumber : (cache.serials[serial]?.internalNumber ?? null),
      status: cache.serials[serial]?.status || 'DISPONIBLE'
    };
    this.saveMetadataCache(cache);

    // 2. Actualizar en Supabase
    const numVal = !isNaN(Number(internalNumber)) ? Number(internalNumber) : null;
    try {
      const { error: fullError } = await supabase
        .from('expected_series')
        .update({
          is_scanned: true,
          scanned_at: new Date().toISOString(),
          warehouse_row: row,
          internal_number: numVal
        })
        .eq('checklist_id', checklistId)
        .eq('serial_number', serial);

      if (fullError) {
        // Fallback si la columna internal_number no ha sido migrada en Supabase
        await supabase
          .from('expected_series')
          .update({
            is_scanned: true,
            scanned_at: new Date().toISOString(),
            warehouse_row: row
          })
          .eq('checklist_id', checklistId)
          .eq('serial_number', serial);
      }
    } catch {
      await supabase
        .from('expected_series')
        .update({
          is_scanned: true,
          scanned_at: new Date().toISOString()
        })
        .eq('checklist_id', checklistId)
        .eq('serial_number', serial);
    }
  }

  /**
   * Actualiza el número interno asignado a una impresora
   */
  static async updatePrinterInternalNumber(serialNumber, internalNumber) {
    const serial = serialNumber.trim().toUpperCase();
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    cache.serials[serial] = {
      ...(cache.serials[serial] || {}),
      internalNumber: internalNumber
    };
    this.saveMetadataCache(cache);

    try {
      const numVal = !isNaN(Number(internalNumber)) ? Number(internalNumber) : null;
      await supabase
        .from('expected_series')
        .update({ internal_number: numVal })
        .eq('serial_number', serial);
    } catch (e) {
      console.warn('Columna internal_number pendiente de migración:', e);
    }
  }

  /**
   * Actualiza el nombre de una fila en las impresoras ya asignadas a esa fila
   */
  static renameWarehouseRowInCache(oldRowName, newRowName) {
    if (!oldRowName || !newRowName || oldRowName === newRowName) return;
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    let changed = false;
    for (const s of Object.keys(cache.serials)) {
      if (cache.serials[s]?.warehouseRow === oldRowName) {
        cache.serials[s].warehouseRow = newRowName;
        changed = true;
      }
    }
    if (changed) {
      this.saveMetadataCache(cache);
    }
  }

  /**
   * Actualiza el estado de una impresora: 'CONSULTA', 'BAJA' o 'DISPONIBLE'
   */
  static async updatePrinterStatus(serialNumber, newStatus) {
    const serial = serialNumber.trim().toUpperCase();
    
    // 1. Guardar en caché local
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    cache.serials[serial] = {
      ...(cache.serials[serial] || {}),
      status: newStatus
    };
    this.saveMetadataCache(cache);

    // 2. Intentar actualizar en Supabase si la columna existe
    try {
      await supabase
        .from('expected_series')
        .update({ printer_status: newStatus })
        .eq('serial_number', serial);
    } catch (e) {
      console.warn('Columna printer_status en Supabase pendiente de migración:', e);
    }
  }

  /**
   * Actualiza manualmente la fila/ubicación de una impresora
   */
  static async updatePrinterRow(serialNumber, newRow) {
    const serial = serialNumber.trim().toUpperCase();
    const row = newRow || 'Fila 1';

    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    cache.serials[serial] = {
      ...(cache.serials[serial] || {}),
      warehouseRow: row
    };
    this.saveMetadataCache(cache);

    try {
      await supabase
        .from('expected_series')
        .update({ warehouse_row: row })
        .eq('serial_number', serial);
    } catch (e) {
      console.warn('Columna warehouse_row pendiente de migración:', e);
    }
  }

  /**
   * Asigna ubicación completa en almacén (Almacén, Fila y Espacio) y vincula datos
   */
  static async assignPrinterLocation(serialNumber, { warehouseName = 'Almacén 1', warehouseRow = 'Fila 1', warehouseSpace = '', internalNumber = null }) {
    const serial = serialNumber.trim().toUpperCase();
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    
    const existing = cache.serials[serial] || {};
    const finalWh = warehouseName || existing.warehouseName || 'Almacén 1';
    const finalRow = warehouseRow || existing.warehouseRow || 'Fila 1';
    const finalSpace = (warehouseSpace || '').trim();
    const finalInternal = internalNumber !== undefined && internalNumber !== null && internalNumber !== ''
      ? internalNumber
      : (existing.internalNumber ?? null);

    cache.serials[serial] = {
      ...existing,
      warehouseName: finalWh,
      warehouseRow: finalRow,
      warehouseSpace: finalSpace,
      internalNumber: finalInternal,
      isScanned: true,
      assignedAt: new Date().toISOString()
    };
    this.saveMetadataCache(cache);

    // Intentar actualizar en Supabase
    try {
      const numVal = !isNaN(Number(finalInternal)) ? Number(finalInternal) : null;
      const { error } = await supabase
        .from('expected_series')
        .update({
          warehouse_name: finalWh,
          warehouse_row: finalRow,
          warehouse_space: finalSpace,
          internal_number: numVal,
          is_scanned: true,
          scanned_at: new Date().toISOString()
        })
        .eq('serial_number', serial);

      if (error) {
        // Fallback si faltan columnas nuevas
        await supabase
          .from('expected_series')
          .update({
            warehouse_row: finalRow,
            is_scanned: true,
            scanned_at: new Date().toISOString()
          })
          .eq('serial_number', serial);
      }
    } catch (e) {
      console.warn('Persistencia en base de datos tolerante a fallos:', e);
    }

    return cache.serials[serial];
  }

  /**
   * Registra una serie inesperada / no registrada en el lote
   */
  static async logUnexpectedScan(checklistId, serialNumber) {
    await supabase
      .from('unexpected_logs')
      .insert({
        checklist_id: checklistId,
        scanned_value: serialNumber.trim().toUpperCase()
      });
  }

  /**
   * Marca un checklist como completado
   */
  static async markChecklistCompleted(checklistId) {
    await supabase
      .from('checklists')
      .update({ status: 'completed' })
      .eq('id', checklistId);
  }

  /**
   * Elimina un checklist
   */
  static async deleteChecklist(checklistId) {
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', checklistId);

    if (error) throw error;
  }

  /**
   * Carga la configuración de rectángulos del mapa del almacén
   */
  static loadMapLayout() {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(MAP_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return new WarehouseMapModel(parsed);
        }
      }
    } catch (e) {
      console.warn('Error leyendo layout de mapa local:', e);
    }
    return new WarehouseMapModel();
  }

  /**
   * Guarda la configuración de rectángulos del mapa del almacén
   */
  static saveMapLayout(warehouseMapModel) {
    try {
      const data = warehouseMapModel.toJSON();
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(MAP_KEY, JSON.stringify(data));
      }
      
      // Intentar guardar en Supabase si la tabla warehouse_map_config existe
      supabase
        .from('warehouse_map_config')
        .upsert({ id: 'default_layout', layout: data, updated_at: new Date().toISOString() })
        .then(() => {})
        .catch(() => {});
    } catch (e) {
      console.warn('Error guardando layout de mapa:', e);
    }
  }

  /**
   * Reconcilia una sola impresora: si ya existe le asigna número de equipo y/o ubicación;
   * si no existe, la crea en el inventario.
   */
  static async reconcileSinglePrinter({ serial, material, internalNumber, warehouseName, warehouseRow, warehouseSpace }) {
    const serialUpper = (serial || '').trim().toUpperCase();
    if (!serialUpper) return { isUpdate: false };

    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    const existing = cache.serials[serialUpper];
    const isUpdate = Boolean(existing);

    const finalInternal = (internalNumber !== undefined && internalNumber !== null && String(internalNumber).trim() !== '')
      ? internalNumber
      : (existing?.internalNumber ?? null);

    const finalWh = warehouseName || existing?.warehouseName || 'Almacén 1';
    const finalRow = warehouseRow || existing?.warehouseRow || 'Sin Asignar';
    const finalSpace = warehouseSpace !== null && warehouseSpace !== undefined && String(warehouseSpace).trim() !== ''
      ? String(warehouseSpace).trim()
      : (existing?.warehouseSpace || '');

    cache.serials[serialUpper] = {
      ...(existing || {}),
      material: material || existing?.material || 'Sin Modelo',
      warehouseName: finalWh,
      warehouseRow: finalRow,
      warehouseSpace: finalSpace,
      internalNumber: finalInternal,
      isScanned: true,
      status: existing?.status || 'DISPONIBLE',
      assignedAt: new Date().toISOString()
    };
    this.saveMetadataCache(cache);

    try {
      const numVal = !isNaN(Number(finalInternal)) ? Number(finalInternal) : null;
      const { data: updatedRows, error: updateErr } = await supabase
        .from('expected_series')
        .update({
          internal_number: numVal,
          warehouse_name: finalWh,
          warehouse_row: finalRow,
          warehouse_space: finalSpace,
          is_scanned: true
        })
        .eq('serial_number', serialUpper)
        .select();

      if (!updateErr && updatedRows && updatedRows.length > 0) {
        return { isUpdate: true };
      }

      // Si no existía en Supabase, creamos o usamos el lote de Inventario Maestro
      let defaultBatchId = null;
      const { data: generalBatch } = await supabase
        .from('checklists')
        .select('id')
        .eq('name', 'Inventario Maestro')
        .maybeSingle();

      if (generalBatch) {
        defaultBatchId = generalBatch.id;
      } else {
        const { data: createdBatch } = await supabase
          .from('checklists')
          .insert({ name: 'Inventario Maestro', status: 'completed', folio: 'MAESTRO' })
          .select('id')
          .single();
        if (createdBatch) defaultBatchId = createdBatch.id;
      }

      if (defaultBatchId) {
        await supabase
          .from('expected_series')
          .insert({
            checklist_id: defaultBatchId,
            serial_number: serialUpper,
            material_model: material || 'Sin Modelo',
            internal_number: numVal,
            warehouse_name: finalWh,
            warehouse_row: finalRow,
            warehouse_space: finalSpace,
            is_scanned: true
          });
      }
    } catch (e) {
      console.warn('Error sincronizando serie reconciliada en Supabase:', e);
    }

    return { isUpdate };
  }

  /**
   * Depura los checklists completados sin perder las impresoras asociadas en el inventario.
   */
  static async clearCompletedChecklists(completedBatchIds = []) {
    if (!completedBatchIds || completedBatchIds.length === 0) return;

    try {
      let masterBatchId = null;
      const { data: mb } = await supabase
        .from('checklists')
        .select('id')
        .eq('name', 'Inventario Maestro')
        .maybeSingle();

      if (mb) {
        masterBatchId = mb.id;
      } else {
        const { data: nmb } = await supabase
          .from('checklists')
          .insert({ name: 'Inventario Maestro', status: 'completed', folio: 'MAESTRO' })
          .select('id')
          .single();
        if (nmb) masterBatchId = nmb.id;
      }

      if (masterBatchId) {
        for (const bid of completedBatchIds) {
          if (bid !== masterBatchId) {
            await supabase
              .from('expected_series')
              .update({ checklist_id: masterBatchId })
              .eq('checklist_id', bid);
          }
        }
      }

      for (const bid of completedBatchIds) {
        if (bid !== masterBatchId) {
          await supabase.from('checklists').delete().eq('id', bid);
        }
      }
    } catch (e) {
      console.error('Error depurando checklists:', e);
    }
  }
}
