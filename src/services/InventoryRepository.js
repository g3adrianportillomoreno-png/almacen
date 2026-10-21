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
   * Obtiene todas las series esperadas de Supabase utilizando paginación automática por lotes.
   * Supera el límite estricto de 1,000 registros de PostgREST de Supabase para soportar
   * archivos masivos de más de 1000 registros (ej. 1,118 o más).
   */
  static async fetchAllExpectedSeries() {
    const PAGE_SIZE = 1000;
    let allSeries = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let queryRes = await supabase
        .from('expected_series')
        .select('id, checklist_id, serial_number, material_model, is_scanned, scanned_at, warehouse_name, warehouse_row, warehouse_space, internal_number, printer_status, assigned_at, system_status')
        .order('id', { ascending: true })
        .range(from, to);

      if (queryRes.error) {
        queryRes = await supabase
          .from('expected_series')
          .select('id, checklist_id, serial_number, material_model, is_scanned, scanned_at, warehouse_name, warehouse_row, warehouse_space, internal_number, printer_status, assigned_at')
          .order('id', { ascending: true })
          .range(from, to);
      }

      const { data, error } = queryRes;

      if (error) {
        console.error('Error paginando expected_series desde Supabase:', error);
        break;
      }

      if (data && data.length > 0) {
        allSeries.push(...data);
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    return allSeries;
  }

  /**
   * Carga todos los checklists desde Supabase combinando los datos y modelos de dominio.
   * Carga la totalidad de las series sin límite de 1000 registros.
   */
  static async fetchAllChecklists() {
    // 1. Obtener la lista de checklists con sus logs inesperados
    const { data: checklistsData, error: checklistsError } = await supabase
      .from('checklists')
      .select(`
        id, name, created_at, status,
        unexpected_logs (id, scanned_value, created_at)
      `)
      .order('created_at', { ascending: false });

    if (checklistsError) {
      console.error('Error al obtener checklists desde Supabase:', checklistsError);
      throw checklistsError;
    }

    // 2. Obtener todas las series esperadas con paginación completa (superando el límite de 1000)
    const allExpectedSeries = await this.fetchAllExpectedSeries();

    // 3. Agrupar las series esperadas por su checklist_id
    const seriesByChecklist = {};
    for (const item of allExpectedSeries) {
      if (!seriesByChecklist[item.checklist_id]) {
        seriesByChecklist[item.checklist_id] = [];
      }
      seriesByChecklist[item.checklist_id].push(item);
    }

    const metadataCache = this.getMetadataCache();

    // 4. Mapear cada registro de BD al modelo ChecklistModel inyectando sus series completas
    // Excluir lotes de Mercado Libre que usan la tabla checklists como respaldo en la nube
    const validChecklists = (checklistsData || []).filter(dbBatch => {
      const nm = (dbBatch.name || '').trim().toUpperCase();
      const fl = (dbBatch.folio || '').trim().toUpperCase();
      return !nm.startsWith('[ML-') && !fl.startsWith('ML-');
    });

    return validChecklists.map((dbBatch, index) => {
      const fullBatch = {
        ...dbBatch,
        expected_series: seriesByChecklist[dbBatch.id] || []
      };
      return ChecklistModel.fromDb(fullBatch, index, metadataCache);
    });
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
      if (s.internalNumber || s.documentName) {
        cache.serials[s.serial] = {
          ...(cache.serials[s.serial] || {}),
          internalNumber: s.internalNumber,
          documentName: s.documentName
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

    // Insertar series esperadas con internal_number y system_status (por defecto 'Principal')
    const seriesToInsert = series.map(s => ({
      checklist_id: batchData.id,
      serial_number: s.serial,
      material_model: s.material,
      internal_number: s.internalNumber && !isNaN(Number(s.internalNumber)) ? Number(s.internalNumber) : null,
      system_status: s.systemStatus || 'Principal',
      document_name: s.documentName || null,
      is_scanned: false
    }));

    // Función auxiliar para insertar en chunks
    const insertInChunks = async (dataArray, fallback = false) => {
      const chunkSize = 500;
      for (let i = 0; i < dataArray.length; i += chunkSize) {
        const chunk = dataArray.slice(i, i + chunkSize);
        if (fallback) {
           await supabase.from('expected_series').insert(chunk);
        } else {
           const { error: chunkError } = await supabase.from('expected_series').insert(chunk);
           if (chunkError) throw chunkError;
        }
      }
    };

    try {
      await insertInChunks(seriesToInsert, false);
    } catch {
      // Fallback si la columna system_status o internal_number aún no existen en Supabase
      try {
        const fallbackWithInternal = series.map(s => ({
          checklist_id: batchData.id,
          serial_number: s.serial,
          material_model: s.material,
          internal_number: s.internalNumber && !isNaN(Number(s.internalNumber)) ? Number(s.internalNumber) : null,
          is_scanned: false
        }));
        await insertInChunks(fallbackWithInternal, false);
      } catch {
        const baseSeries = series.map(s => ({
          checklist_id: batchData.id,
          serial_number: s.serial,
          material_model: s.material,
          is_scanned: false
        }));
        await insertInChunks(baseSeries, true);
      }
    }

    return batchData;
  }

  /**
   * Actualiza el escaneo de una serie: la marca como completada (presente).
   * Si no se proporciona fila (escaneo rápido de checklist), conserva su ubicación o la deja en 'Sin Asignar' para ubicarse después.
   */
  static async registerScan(checklistId, serialNumber, warehouseRow = null, internalNumber = null) {
    const serial = serialNumber.trim().toUpperCase();
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    const existing = cache.serials[serial] || {};
    const row = warehouseRow || existing.warehouseRow || 'Sin Asignar';

    // 1. Guardar en caché local
    cache.serials[serial] = {
      ...existing,
      isScanned: true,
      warehouseRow: row,
      internalNumber: internalNumber !== null && internalNumber !== undefined ? internalNumber : (existing.internalNumber ?? null),
      status: existing.status || 'DISPONIBLE'
    };
    this.saveMetadataCache(cache);

    // 2. Actualizar en Supabase
    const numVal = internalNumber !== null && internalNumber !== undefined && !isNaN(Number(internalNumber)) ? Number(internalNumber) : null;
    const updatePayload = {
      is_scanned: true,
      scanned_at: new Date().toISOString(),
      warehouse_row: row
    };
    if (numVal !== null) {
      updatePayload.internal_number = numVal;
    }

    try {
      const { error: fullError } = await supabase
        .from('expected_series')
        .update(updatePayload)
        .eq('checklist_id', checklistId)
        .eq('serial_number', serial);

      if (fullError) {
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
  static async assignPrinterLocation(serialNumber, { warehouseName = 'Almacén 1', warehouseRow = 'Fila 1', warehouseSpace = '', internalNumber = null, systemStatus = null }) {
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
    const finalSystemStatus = systemStatus || existing.systemStatus || 'Principal';

    cache.serials[serial] = {
      ...existing,
      warehouseName: finalWh,
      warehouseRow: finalRow,
      warehouseSpace: finalSpace,
      internalNumber: finalInternal,
      systemStatus: finalSystemStatus,
      isScanned: true,
      assignedAt: new Date().toISOString()
    };
    this.saveMetadataCache(cache);

    // Intentar actualizar en Supabase
    try {
      const numVal = !isNaN(Number(finalInternal)) ? Number(finalInternal) : null;
      const encodedStatus = `${existing.status || 'DISPONIBLE'}|${finalSystemStatus}`;
      const { error } = await supabase
        .from('expected_series')
        .update({
          warehouse_name: finalWh,
          warehouse_row: finalRow,
          warehouse_space: finalSpace,
          internal_number: numVal,
          printer_status: encodedStatus,
          system_status: finalSystemStatus,
          is_scanned: true,
          scanned_at: new Date().toISOString()
        })
        .eq('serial_number', serial);

      if (error) {
        // Fallback si aún no existe la columna system_status en Supabase (guarda el Estado dentro de printer_status)
        await supabase
          .from('expected_series')
          .update({
            warehouse_name: finalWh,
            warehouse_row: finalRow,
            warehouse_space: finalSpace,
            internal_number: numVal,
            printer_status: encodedStatus,
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
        supabase
          .from('checklists')
          .update({ folio: 'MAESTRO', status: 'completed' })
          .eq('id', defaultBatchId)
          .then(() => {})
          .catch(() => {});
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
   * Reconciliación e importación ultrarrápida por lotes masivos (Batching).
   * Procesa cientos de filas en bloques de alta velocidad (menos de 1 segundo).
   */
  static async reconcileBatchPrinters(items = []) {
    if (!items || items.length === 0) return { updated: 0, added: 0, total: 0 };

    // 1. Obtener o crear el lote contenedor de Inventario Maestro una sola vez
    let defaultBatchId = null;
    try {
      const { data: generalBatch } = await supabase
        .from('checklists')
        .select('id')
        .eq('name', 'Inventario Maestro')
        .maybeSingle();

      if (generalBatch) {
        defaultBatchId = generalBatch.id;
        supabase
          .from('checklists')
          .update({ folio: 'MAESTRO', status: 'completed' })
          .eq('id', defaultBatchId)
          .then(() => {})
          .catch(() => {});
      } else {
        const { data: createdBatch } = await supabase
          .from('checklists')
          .insert({ name: 'Inventario Maestro', status: 'completed', folio: 'MAESTRO' })
          .select('id')
          .single();
        if (createdBatch) defaultBatchId = createdBatch.id;
      }
    } catch (e) {
      console.warn('Error obteniendo lote maestro para batch:', e);
    }

    // 2. Procesar caché local de metadatos en un solo paso en memoria
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};

    const cleanItems = [];
    const serialsSet = new Set();

    for (const item of items) {
      const serialUpper = (item.serial || '').trim().toUpperCase();
      if (!serialUpper || serialsSet.has(serialUpper)) continue;
      serialsSet.add(serialUpper);

      const existing = cache.serials[serialUpper];
      const finalInternal = (item.internalNumber !== undefined && item.internalNumber !== null && String(item.internalNumber).trim() !== '')
        ? item.internalNumber
        : (existing?.internalNumber ?? null);

      const finalWh = item.warehouseName || existing?.warehouseName || 'Almacén 1';
      const finalRow = item.warehouseRow || existing?.warehouseRow || 'Sin Asignar';
      const finalSpace = item.warehouseSpace !== null && item.warehouseSpace !== undefined && String(item.warehouseSpace).trim() !== ''
        ? String(item.warehouseSpace).trim()
        : (existing?.warehouseSpace || '');
      const finalSystemStatus = item.systemStatus || existing?.systemStatus || 'Principal';

      cache.serials[serialUpper] = {
        ...(existing || {}),
        material: item.material || existing?.material || 'Sin Modelo',
        warehouseName: finalWh,
        warehouseRow: finalRow,
        warehouseSpace: finalSpace,
        internalNumber: finalInternal,
        systemStatus: finalSystemStatus,
        isScanned: true,
        status: existing?.status || 'DISPONIBLE',
        assignedAt: new Date().toISOString()
      };

      const numVal = !isNaN(Number(finalInternal)) ? Number(finalInternal) : null;
      cleanItems.push({
        serialUpper,
        material: item.material || existing?.material || 'Sin Modelo',
        numVal,
        finalWh,
        finalRow,
        finalSpace,
        finalSystemStatus
      });
    }

    // Guardar caché local una sola vez para toda la tanda
    this.saveMetadataCache(cache);

    // 3. Sincronizar con Supabase en chunks de 80 registros
    let updated = 0;
    let added = 0;
    const CHUNK_SIZE = 80;

    for (let i = 0; i < cleanItems.length; i += CHUNK_SIZE) {
      const chunk = cleanItems.slice(i, i + CHUNK_SIZE);
      const chunkSerials = chunk.map(c => c.serialUpper);

      try {
        const { data: existingDbRows } = await supabase
          .from('expected_series')
          .select('id, serial_number')
          .in('serial_number', chunkSerials);

        const existingDbSerials = new Set((existingDbRows || []).map(r => r.serial_number));

        const toInsert = [];
        const toUpdatePromises = [];

        for (const c of chunk) {
          const encodedStatus = `DISPONIBLE|${c.finalSystemStatus}`;
          if (existingDbSerials.has(c.serialUpper)) {
            updated++;
            toUpdatePromises.push(
              supabase
                .from('expected_series')
                .update({
                  internal_number: c.numVal,
                  warehouse_name: c.finalWh,
                  warehouse_row: c.finalRow,
                  warehouse_space: c.finalSpace,
                  printer_status: encodedStatus,
                  is_scanned: true
                })
                .eq('serial_number', c.serialUpper)
            );
          } else {
            added++;
            if (defaultBatchId) {
              toInsert.push({
                checklist_id: defaultBatchId,
                serial_number: c.serialUpper,
                material_model: c.material,
                internal_number: c.numVal,
                warehouse_name: c.finalWh,
                warehouse_row: c.finalRow,
                warehouse_space: c.finalSpace,
                printer_status: encodedStatus,
                is_scanned: true
              });
            }
          }
        }

        const batchPromises = [];
        if (toInsert.length > 0) {
          batchPromises.push(supabase.from('expected_series').insert(toInsert));
        }
        if (toUpdatePromises.length > 0) {
          batchPromises.push(...toUpdatePromises);
        }
        await Promise.allSettled(batchPromises);
      } catch (err) {
        console.warn('Error en sincronización de chunk Supabase:', err);
      }
    }

    return { updated, added, total: cleanItems.length };
  }

  /**
   * Actualiza el Inventario Maestro con purga de bajas por diferencia:
   * 1. Registra las impresoras eliminadas en el historial de bajas (inventory_departures).
   * 2. Las elimina de la base de datos activa (expected_series).
   * 3. Actualiza o inserta las impresoras leídas del archivo.
   */
  static async updateMasterWithPurge(items = [], removedPrinters = []) {
    // 1. Registrar en historial de bajas
    if (removedPrinters && removedPrinters.length > 0) {
      await this.logDepartures(removedPrinters, 'Baja por actualización de archivo maestro');

      // 2. Eliminar de Supabase en chunks
      const removedSerials = removedPrinters.map(p => (p.serial || p).trim().toUpperCase());
      const cache = this.getMetadataCache();
      cache.serials = cache.serials || {};

      for (const s of removedSerials) {
        delete cache.serials[s];
      }
      this.saveMetadataCache(cache);

      const CHUNK_SIZE = 100;
      for (let i = 0; i < removedSerials.length; i += CHUNK_SIZE) {
        const chunk = removedSerials.slice(i, i + CHUNK_SIZE);
        try {
          await supabase.from('expected_series').delete().in('serial_number', chunk);
        } catch (e) {
          console.warn('Error eliminando bajas de expected_series:', e);
        }
      }
    }

    // 3. Reconciliar las impresoras del nuevo archivo
    const reconcileRes = await this.reconcileBatchPrinters(items);

    return {
      totalRead: items.length,
      removedCount: removedPrinters.length,
      updated: reconcileRes.updated,
      added: reconcileRes.added
    };
  }

  /**
   * Registra impresoras en la tabla de historial de bajas (inventory_departures)
   */
  static async logDepartures(printers = [], reason = 'Baja de inventario') {
    if (!printers || printers.length === 0) return;

    const nowIso = new Date().toISOString();
    const rowsToInsert = printers.map(p => ({
      serial: (p.serial || p).trim().toUpperCase(),
      material: p.material || 'Sin Modelo',
      internal_number: p.internalNumber !== undefined && p.internalNumber !== null ? String(p.internalNumber) : null,
      warehouse_name: p.warehouseName || 'Almacén 1',
      warehouse_row: p.warehouseRow || 'Sin Asignar',
      warehouse_space: p.warehouseSpace || '',
      system_status: p.systemStatus || 'Principal',
      reason: reason,
      departure_date: nowIso
    }));

    // Respaldo en localStorage
    try {
      const rawCache = localStorage.getItem('cdm_inventory_departures_v1');
      const currentList = rawCache ? JSON.parse(rawCache) : [];
      const updatedList = [...rowsToInsert, ...currentList].slice(0, 2000);
      localStorage.setItem('cdm_inventory_departures_v1', JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Error guardando bajas en local storage:', e);
    }

    // Guardar en Supabase en chunks
    const CHUNK = 80;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const chunk = rowsToInsert.slice(i, i + CHUNK);
      try {
        await supabase.from('inventory_departures').insert(chunk);
      } catch (e) {
        console.warn('Nota Supabase inventory_departures:', e.message);
      }
    }
  }

  /**
   * Obtiene el historial de bajas del último mes (30 días) y purga las más antiguas
   */
  static async fetchDeparturesHistory() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Purgar registros mayores a 30 días en Supabase
    try {
      await supabase.from('inventory_departures').delete().lt('departure_date', thirtyDaysAgo);
    } catch (e) {
      // Ignorar si la tabla aún no existe en Supabase
    }

    // 2. Consultar historial de bajas de los últimos 30 días en Supabase
    try {
      const { data, error } = await supabase
        .from('inventory_departures')
        .select('*')
        .gte('departure_date', thirtyDaysAgo)
        .order('departure_date', { ascending: false })
        .limit(1000);

      if (!error && data) {
        localStorage.setItem('cdm_inventory_departures_v1', JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn('Consultando bajas desde respaldo local:', e.message);
    }

    // 3. Respaldo en localStorage filtrando los últimos 30 días
    try {
      const rawCache = localStorage.getItem('cdm_inventory_departures_v1');
      if (rawCache) {
        const list = JSON.parse(rawCache);
        const filtered = list.filter(item => {
          const dateField = item.departure_date || item.departed_at;
          if (!dateField) return true;
          return new Date(dateField).getTime() >= (Date.now() - 30 * 24 * 60 * 60 * 1000);
        });
        localStorage.setItem('cdm_inventory_departures_v1', JSON.stringify(filtered));
        return filtered;
      }
    } catch {
      return [];
    }

    return [];
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
