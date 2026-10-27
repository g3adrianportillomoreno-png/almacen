import { supabase } from '../utils/supabaseClient.js';
import { OfflineSyncService } from './OfflineSyncService.js';
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
      const { data, error } = await supabase
        .from('expected_series')
        .select('id, checklist_id, serial_number, material_model, is_scanned, scanned_at, warehouse_name, warehouse_row, warehouse_space, internal_number, printer_status, assigned_at')
        .order('id', { ascending: true })
        .range(from, to);

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
   * Obtiene instantáneamente los checklists desde el snapshot local (para carga en 0ms en celular)
   */
  static getCachedChecklistsSync() {
    try {
      const snapshot = OfflineSyncService.getChecklistsSnapshot();
      if (!snapshot || snapshot.length === 0) return [];
      const metadataCache = this.getMetadataCache();
      return snapshot.map((fullBatch, index) => ChecklistModel.fromDb(fullBatch, index, metadataCache));
    } catch {
      return [];
    }
  }

  /**
   * Carga todos los checklists desde Supabase combinando los datos y modelos de dominio.
   * Carga la totalidad de las series sin límite de 1000 registros.
   */
  static async fetchAllChecklists() {
    const metadataCache = this.getMetadataCache();

    try {
      // 1. Obtener la lista de checklists con sus logs inesperados
      const { data: checklistsData, error: checklistsError } = await supabase
        .from('checklists')
        .select(`
          id, name, created_at, status,
          unexpected_logs (id, scanned_value, created_at)
        `)
        .order('created_at', { ascending: false });

      if (checklistsError) {
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

      // 4. Mapear cada registro de BD al modelo ChecklistModel inyectando sus series completas
      // Excluir lotes de Mercado Libre que usan la tabla checklists como respaldo en la nube
      const validChecklists = (checklistsData || []).filter(dbBatch => {
        const nm = (dbBatch.name || '').trim().toUpperCase();
        const fl = (dbBatch.folio || '').trim().toUpperCase();
        return !nm.startsWith('[ML-') && !fl.startsWith('ML-');
      });

      const fullBatchesRaw = validChecklists.map(dbBatch => ({
        ...dbBatch,
        expected_series: seriesByChecklist[dbBatch.id] || []
      }));

      // Guardar snapshot de respaldo offline para el celular de forma diferida para no bloquear el hilo principal
      setTimeout(() => {
        OfflineSyncService.saveChecklistsSnapshot(fullBatchesRaw);
      }, 50);

      return fullBatchesRaw.map((fullBatch, index) => {
        return ChecklistModel.fromDb(fullBatch, index, metadataCache);
      });
    } catch (err) {
      console.warn('Advertencia cargando checklists desde Supabase (posible desconexión):', err.message);
      const snapshot = OfflineSyncService.getChecklistsSnapshot();
      if (snapshot && snapshot.length > 0) {
        console.log('📶 Modo fuera de línea: usando snapshot local de checklists');
        return snapshot.map((fullBatch, index) => {
          return ChecklistModel.fromDb(fullBatch, index, metadataCache);
        });
      }
      throw err;
    }
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
    const nowIso = new Date().toISOString();

    // 1. Guardar inmediatamente en caché local de este dispositivo (0ms de latencia)
    cache.serials[serial] = {
      ...existing,
      isScanned: true,
      warehouseRow: row,
      internalNumber: internalNumber !== null && internalNumber !== undefined ? internalNumber : (existing.internalNumber ?? null),
      status: existing.status || 'DISPONIBLE'
    };
    this.saveMetadataCache(cache);

    // 2. Si no hay conexión a internet, encolar de inmediato para sincronizar al volver el Wi-Fi
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('REGISTER_SCAN', {
        checklistId,
        serialNumber: serial,
        warehouseRow: row,
        internalNumber,
        scannedAt: nowIso
      });
      return;
    }

    // 3. Si hay conexión, intentar actualizar en Supabase
    const numVal = internalNumber !== null && internalNumber !== undefined && !isNaN(Number(internalNumber)) ? Number(internalNumber) : null;
    const updatePayload = {
      is_scanned: true,
      scanned_at: nowIso,
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
        const { error: fbErr } = await supabase
          .from('expected_series')
          .update({
            is_scanned: true,
            scanned_at: nowIso,
            warehouse_row: row
          })
          .eq('checklist_id', checklistId)
          .eq('serial_number', serial);

        if (fbErr) {
          OfflineSyncService.addToQueue('REGISTER_SCAN', {
            checklistId,
            serialNumber: serial,
            warehouseRow: row,
            internalNumber,
            scannedAt: nowIso
          });
        }
      }
    } catch (networkErr) {
      console.warn('Fallo de red al registrar escaneo. Guardando en cola offline:', networkErr);
      OfflineSyncService.addToQueue('REGISTER_SCAN', {
        checklistId,
        serialNumber: serial,
        warehouseRow: row,
        internalNumber,
        scannedAt: nowIso
      });
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
  /**
   * Marca una serie del checklist como baja junto con su fecha (salida de equipo)
   */
  static async markChecklistPrinterBaja(checklistId, serialNumber, bajaDate = null, reason = 'Baja de checklist') {
    const serial = String(serialNumber || '').trim().toUpperCase();
    if (!serial) return null;
    const nowIso = bajaDate ? new Date(bajaDate).toISOString() : new Date().toISOString();

    // 1. Guardar inmediatamente en caché local
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    const existing = cache.serials[serial] || {};
    cache.serials[serial] = {
      ...existing,
      status: 'BAJA',
      bajaAt: nowIso,
      bajaReason: reason || 'Baja de checklist',
      isScanned: true
    };
    this.saveMetadataCache(cache);

    // 2. Si no hay conexión, encolar en OfflineSyncService
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('MARK_CHECKLIST_BAJA', {
        checklistId,
        serialNumber: serial,
        bajaDate: nowIso,
        reason
      });
      return cache.serials[serial];
    }

    // 3. Actualizar en Supabase
    try {
      const { error } = await supabase
        .from('expected_series')
        .update({
          printer_status: 'BAJA',
          is_scanned: true
        })
        .eq('checklist_id', checklistId)
        .eq('serial_number', serial);

      if (error) {
        OfflineSyncService.addToQueue('MARK_CHECKLIST_BAJA', {
          checklistId,
          serialNumber: serial,
          bajaDate: nowIso,
          reason
        });
      }
    } catch (err) {
      console.warn('Error actualizando baja en Supabase, encolando offline:', err);
      OfflineSyncService.addToQueue('MARK_CHECKLIST_BAJA', {
        checklistId,
        serialNumber: serial,
        bajaDate: nowIso,
        reason
      });
    }

    return cache.serials[serial];
  }

  /**
   * Cancela la baja de una serie de checklist restaurándola a DISPONIBLE
   */
  static async cancelChecklistPrinterBaja(checklistId, serialNumber) {
    const serial = String(serialNumber || '').trim().toUpperCase();
    if (!serial) return null;

    // 1. Guardar en caché local
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    const existing = cache.serials[serial] || {};
    cache.serials[serial] = {
      ...existing,
      status: 'DISPONIBLE',
      bajaAt: null,
      bajaReason: null
    };
    this.saveMetadataCache(cache);

    // 2. Si no hay conexión, encolar en OfflineSyncService
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('CANCEL_CHECKLIST_BAJA', {
        checklistId,
        serialNumber: serial
      });
      return cache.serials[serial];
    }

    // 3. Actualizar en Supabase
    try {
      const { error } = await supabase
        .from('expected_series')
        .update({
          printer_status: 'DISPONIBLE'
        })
        .eq('checklist_id', checklistId)
        .eq('serial_number', serial);

      if (error) {
        OfflineSyncService.addToQueue('CANCEL_CHECKLIST_BAJA', {
          checklistId,
          serialNumber: serial
        });
      }
    } catch (err) {
      console.warn('Error cancelando baja en Supabase, encolando offline:', err);
      OfflineSyncService.addToQueue('CANCEL_CHECKLIST_BAJA', {
        checklistId,
        serialNumber: serial
      });
    }

    return cache.serials[serial];
  }

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

    const nowIso = new Date().toISOString();

    // Si está offline, guardar en la cola para sincronizar al volver el Wi-Fi
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('ASSIGN_LOCATION', {
        serialNumber: serial,
        warehouseName: finalWh,
        warehouseRow: finalRow,
        warehouseSpace: finalSpace,
        internalNumber: finalInternal,
        systemStatus: finalSystemStatus,
        scannedAt: nowIso
      });
      return cache.serials[serial];
    }

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
          scanned_at: nowIso
        })
        .eq('serial_number', serial);

      if (error) {
        const { error: fbErr } = await supabase
          .from('expected_series')
          .update({
            warehouse_name: finalWh,
            warehouse_row: finalRow,
            warehouse_space: finalSpace,
            internal_number: numVal,
            printer_status: encodedStatus,
            is_scanned: true,
            scanned_at: nowIso
          })
          .eq('serial_number', serial);

        if (fbErr) {
          OfflineSyncService.addToQueue('ASSIGN_LOCATION', {
            serialNumber: serial,
            warehouseName: finalWh,
            warehouseRow: finalRow,
            warehouseSpace: finalSpace,
            internalNumber: finalInternal,
            systemStatus: finalSystemStatus,
            scannedAt: nowIso
          });
        }
      }
    } catch (e) {
      console.warn('Fallo de red en asignación. Guardando en cola offline:', e);
      OfflineSyncService.addToQueue('ASSIGN_LOCATION', {
        serialNumber: serial,
        warehouseName: finalWh,
        warehouseRow: finalRow,
        warehouseSpace: finalSpace,
        internalNumber: finalInternal,
        systemStatus: finalSystemStatus,
        scannedAt: nowIso
      });
    }

    return cache.serials[serial];
  }

  /**
   * Registra una serie inesperada / no registrada en el lote
   */
  static async logUnexpectedScan(checklistId, serialNumber) {
    const val = serialNumber.trim().toUpperCase();
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('LOG_UNEXPECTED', { checklistId, serialNumber: val });
      return;
    }
    try {
      const { error } = await supabase
        .from('unexpected_logs')
        .insert({
          checklist_id: checklistId,
          scanned_value: val
        });
      if (error) throw error;
    } catch (e) {
      OfflineSyncService.addToQueue('LOG_UNEXPECTED', { checklistId, serialNumber: val });
    }
  }

  /**
   * Reconcilia una serie faltante con una lectura de error por diferencia de OCR:
   * actualiza serial_number al valor real escaneado, lo marca is_scanned = true y limpia unexpected_logs.
   */
  static async reconcileSimilarSerial(checklistId, expectedSerial, scannedRealSerial, rawUnexpectedValue) {
    const oldSerial = String(expectedSerial || '').trim().toUpperCase();
    const realSerial = String(scannedRealSerial || '').trim().toUpperCase();
    const rawUnexp = String(rawUnexpectedValue || realSerial).trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};
    const existing = cache.serials[oldSerial] || cache.serials[realSerial] || {};
    cache.serials[realSerial] = {
      ...existing,
      isScanned: true,
      warehouseRow: existing.warehouseRow || 'Sin Asignar',
      status: existing.status || 'DISPONIBLE'
    };
    if (oldSerial !== realSerial) {
      delete cache.serials[oldSerial];
    }
    this.saveMetadataCache(cache);

    try {
      await supabase
        .from('expected_series')
        .update({
          serial_number: realSerial,
          is_scanned: true,
          scanned_at: nowIso
        })
        .eq('checklist_id', checklistId)
        .eq('serial_number', oldSerial);

      await supabase
        .from('unexpected_logs')
        .delete()
        .eq('checklist_id', checklistId)
        .in('scanned_value', [rawUnexp, realSerial]);
    } catch (e) {
      console.warn('Error al reconciliar serie similar en Supabase:', e);
    }
  }

  /**
   * Marca un checklist como completado
   */
  static async markChecklistCompleted(checklistId) {
    if (!OfflineSyncService.isOnline()) {
      OfflineSyncService.addToQueue('MARK_CHECKLIST_COMPLETED', { checklistId });
      return;
    }
    try {
      const { error } = await supabase
        .from('checklists')
        .update({ status: 'completed' })
        .eq('id', checklistId);
      if (error) throw error;
    } catch (e) {
      OfflineSyncService.addToQueue('MARK_CHECKLIST_COMPLETED', { checklistId });
    }
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
   * Blindado: Si una serie ya existe en Supabase, consulta su ubicación en la nube (warehouse_name,
   * warehouse_row, warehouse_space, internal_number, printer_status) para que NUNCA se borre el espacio
   * asignado desde celulares u otras computadoras cuando el Excel nuevo no trae ubicación.
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

    // 2. Preparar lista única de ítems entrantes del archivo Excel
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};

    const cleanItems = [];
    const serialsSet = new Set();

    for (const item of items) {
      const serialUpper = (item.serial || '').trim().toUpperCase();
      if (!serialUpper || serialsSet.has(serialUpper)) continue;
      serialsSet.add(serialUpper);

      const hasExplicitInternal = item.internalNumber !== undefined && item.internalNumber !== null && String(item.internalNumber).trim() !== '';
      const hasExplicitWh = Boolean(item.warehouseName && String(item.warehouseName).trim() !== '');
      const hasExplicitRow = Boolean(item.warehouseRow && String(item.warehouseRow).trim() !== '' && String(item.warehouseRow).trim() !== 'Sin Asignar');
      const hasExplicitSpace = Boolean(item.warehouseSpace !== null && item.warehouseSpace !== undefined && String(item.warehouseSpace).trim() !== '');
      const hasExplicitSystemStatus = Boolean(item.systemStatus && String(item.systemStatus).trim() !== '');

      cleanItems.push({
        serialUpper,
        rawMaterial: item.material,
        rawInternal: hasExplicitInternal ? item.internalNumber : null,
        rawWh: hasExplicitWh ? String(item.warehouseName).trim() : null,
        rawRow: hasExplicitRow ? String(item.warehouseRow).trim() : null,
        rawSpace: hasExplicitSpace ? String(item.warehouseSpace).trim() : null,
        rawSystemStatus: hasExplicitSystemStatus ? String(item.systemStatus).trim() : null
      });
    }

    // 3. Sincronizar con Supabase en chunks de 80 registros preservando siempre los espacios existentes en la nube
    let updated = 0;
    let added = 0;
    const CHUNK_SIZE = 80;

    for (let i = 0; i < cleanItems.length; i += CHUNK_SIZE) {
      const chunk = cleanItems.slice(i, i + CHUNK_SIZE);
      const chunkSerials = chunk.map(c => c.serialUpper);

      try {
        const { data: existingDbRows } = await supabase
          .from('expected_series')
          .select('id, serial_number, material_model, internal_number, warehouse_name, warehouse_row, warehouse_space, printer_status')
          .in('serial_number', chunkSerials);

        // Mapear el mejor registro existente en Supabase por cada número de serie (priorizando el que ya tenga ubicación)
        const dbRowBySerial = {};
        for (const r of (existingDbRows || [])) {
          const sKey = (r.serial_number || '').trim().toUpperCase();
          if (!dbRowBySerial[sKey] || (r.warehouse_space && !dbRowBySerial[sKey].warehouse_space)) {
            dbRowBySerial[sKey] = r;
          }
        }

        const toInsert = [];
        const toUpdatePromises = [];

        for (const c of chunk) {
          const dbRow = dbRowBySerial[c.serialUpper];
          const localCached = cache.serials[c.serialUpper] || {};

          // Extraer estado operativo e inventario previos desde la nube
          let dbOpStatus = null;
          let dbSysStatus = null;
          if (dbRow?.printer_status) {
            const parts = String(dbRow.printer_status).split('|');
            dbOpStatus = parts[0] || null;
            dbSysStatus = parts[1] || null;
          }

          const finalMaterial = (c.rawMaterial && c.rawMaterial !== 'Sin Modelo' && c.rawMaterial !== 'MODELO GENERAL')
            ? c.rawMaterial
            : (dbRow?.material_model || localCached.material || 'Sin Modelo');

          const finalInternal = c.rawInternal !== null
            ? c.rawInternal
            : (dbRow?.internal_number ?? localCached.internalNumber ?? null);

          const finalWh = c.rawWh
            || dbRow?.warehouse_name
            || localCached.warehouseName
            || 'Almacén 1';

          const dbRowHasValidRow = dbRow?.warehouse_row && dbRow.warehouse_row !== 'Sin Asignar';
          const localHasValidRow = localCached.warehouseRow && localCached.warehouseRow !== 'Sin Asignar';
          const finalRow = c.rawRow
            || (dbRowHasValidRow ? dbRow.warehouse_row : null)
            || (localHasValidRow ? localCached.warehouseRow : null)
            || 'Sin Asignar';

          const finalSpace = c.rawSpace !== null
            ? c.rawSpace
            : (dbRow?.warehouse_space || localCached.warehouseSpace || '');

          const finalOpStatus = dbOpStatus || localCached.status || 'DISPONIBLE';
          const finalSystemStatus = c.rawSystemStatus || dbSysStatus || localCached.systemStatus || 'Principal';
          const encodedStatus = `${finalOpStatus}|${finalSystemStatus}`;
          const numVal = finalInternal !== null && !isNaN(Number(finalInternal)) ? Number(finalInternal) : null;

          // Actualizar caché local con la fusión nube + Excel
          cache.serials[c.serialUpper] = {
            ...localCached,
            material: finalMaterial,
            warehouseName: finalWh,
            warehouseRow: finalRow,
            warehouseSpace: finalSpace,
            internalNumber: finalInternal,
            systemStatus: finalSystemStatus,
            isScanned: true,
            status: finalOpStatus,
            assignedAt: localCached.assignedAt || new Date().toISOString()
          };

          if (dbRow) {
            updated++;
            toUpdatePromises.push(
              supabase
                .from('expected_series')
                .update({
                  material_model: finalMaterial,
                  internal_number: numVal,
                  warehouse_name: finalWh,
                  warehouse_row: finalRow,
                  warehouse_space: finalSpace,
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
                material_model: finalMaterial,
                internal_number: numVal,
                warehouse_name: finalWh,
                warehouse_row: finalRow,
                warehouse_space: finalSpace,
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

    this.saveMetadataCache(cache);
    return { updated, added, total: cleanItems.length };
  }

  /**
   * Actualiza el Inventario Maestro con purga de bajas por diferencia:
   * 1. Protege cualquier Checklist de recepción que esté actualmente pendiente ('pending') para no borrarle equipos sin escanear.
   * 2. Registra las impresoras eliminadas en el historial de bajas (inventory_departures).
   * 3. Las elimina de la base de datos activa (expected_series) excepto si pertenecen a un checklist pendiente.
   * 4. Actualiza o inserta las impresoras leídas del archivo conservando siempre su Almacén, Fila y Espacio.
   */
  static async updateMasterWithPurge(items = [], removedPrinters = []) {
    if (removedPrinters && removedPrinters.length > 0) {
      await this.logDepartures(removedPrinters, 'Baja por actualización de archivo maestro');

      const removedSerials = removedPrinters.map(p => (p.serial || p).trim().toUpperCase());
      const cache = this.getMetadataCache();
      cache.serials = cache.serials || {};

      for (const s of removedSerials) {
        delete cache.serials[s];
      }
      this.saveMetadataCache(cache);

      // Identificar checklists completados/cerrados/maestro donde sí se debe aplicar la baja
      let deletableChecklistIds = null;
      try {
        const { data: allChecklists } = await supabase
          .from('checklists')
          .select('id, status, name');
        if (allChecklists && allChecklists.length > 0) {
          deletableChecklistIds = allChecklists
            .filter(ch => ch.status === 'completed' || ch.status === 'closed' || ch.name === 'Inventario Maestro')
            .map(ch => ch.id);
        }
      } catch (e) {
        console.warn('No se pudo filtrar checklists pendientes antes de purga:', e);
      }

      const CHUNK_SIZE = 100;
      for (let i = 0; i < removedSerials.length; i += CHUNK_SIZE) {
        const chunk = removedSerials.slice(i, i + CHUNK_SIZE);
        try {
          if (deletableChecklistIds && deletableChecklistIds.length > 0) {
            await supabase
              .from('expected_series')
              .delete()
              .in('serial_number', chunk)
              .in('checklist_id', deletableChecklistIds);
          } else {
            await supabase
              .from('expected_series')
              .delete()
              .in('serial_number', chunk);
          }
        } catch (e) {
          console.warn('Error eliminando bajas de expected_series:', e);
        }
      }
    }

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

    try {
      const rawCache = localStorage.getItem('cdm_inventory_departures_v1');
      const currentList = rawCache ? JSON.parse(rawCache) : [];
      const updatedList = [...rowsToInsert, ...currentList].slice(0, 2000);
      localStorage.setItem('cdm_inventory_departures_v1', JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Error guardando bajas en local storage:', e);
    }

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

    try {
      await supabase.from('inventory_departures').delete().lt('departure_date', thirtyDaysAgo);
    } catch (e) {
      // Ignorar si la tabla aún no existe en Supabase
    }

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

  /**
   * Fusiona dos o más checklists existentes en un solo checklist destino (`targetChecklistId`):
   * - Combina todas las series esperadas sin duplicados (modo 'UNION') o actualiza la lista base conservando todo lo escaneado (modo 'BASE_LIST').
   * - Conserva el 100% de las lecturas ya verificadas (`is_scanned = true`), filas, espacios y números internos de cualquiera de los checklists.
   * - Cruza automáticamente las lecturas en `unexpected_logs` (errores escaneados): si una serie que había dado error en un checklist
   *   sí existe en las series esperadas del otro checklist, pasa automáticamente a VERIFICADA (`is_scanned = true`) y se limpia del log de errores.
   */
  static async mergeChecklists({
    targetChecklistId,
    sourceChecklistIds = [],
    mode = 'UNION',
    baseListChecklistId = null,
    deleteSources = true
  }) {
    const cleanSources = (sourceChecklistIds || []).filter(id => id && String(id) !== String(targetChecklistId));
    if (!targetChecklistId || cleanSources.length === 0) {
      throw new Error('Selecciona al menos dos checklists para fusionar.');
    }

    const allIds = [targetChecklistId, ...cleanSources];
    const nowIso = new Date().toISOString();
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};

    // 1. Obtener todas las series esperadas y todos los logs de error de los checklists seleccionados
    const { data: dbSeries, error: seriesErr } = await supabase
      .from('expected_series')
      .select('*')
      .in('checklist_id', allIds);

    if (seriesErr) {
      throw new Error(`Error leyendo series para fusionar: ${seriesErr.message}`);
    }

    const { data: dbUnexpected } = await supabase
      .from('unexpected_logs')
      .select('*')
      .in('checklist_id', allIds);

    // 2. Mapear errores escaneados (unexpected_logs) para cruce automático de correspondencias
    const unexpectedBySerial = new Map();
    const rawUnexpectedList = [];
    for (const log of (dbUnexpected || [])) {
      const rawVal = String(log.scanned_value || '').trim().toUpperCase();
      if (!rawVal) continue;
      const parts = rawVal.split('|');
      const cleanSerial = parts[0].trim();
      const extraRow = parts[1] ? parts[1].trim() : null;
      if (cleanSerial && !unexpectedBySerial.has(cleanSerial)) {
        unexpectedBySerial.set(cleanSerial, {
          rawVal,
          cleanSerial,
          extraRow,
          createdAt: log.created_at || nowIso
        });
      }
      rawUnexpectedList.push({ ...log, cleanSerial, rawVal });
    }

    // 3. Consolidar el estado de cada número de serie entre todos los checklists seleccionados
    const consolidatedBySerial = new Map();
    const targetExistingBySerial = new Map();
    const effectiveBaseId = baseListChecklistId || targetChecklistId;
    const baseChecklistSerials = new Set();

    for (const row of (dbSeries || [])) {
      const serial = String(row.serial_number || '').trim().toUpperCase();
      if (!serial) continue;

      if (String(row.checklist_id) === String(targetChecklistId)) {
        targetExistingBySerial.set(serial, row);
      }
      if (String(row.checklist_id) === String(effectiveBaseId)) {
        baseChecklistSerials.add(serial);
      }

      const prev = consolidatedBySerial.get(serial);
      const localMeta = cache.serials[serial] || {};
      const rowScanned = Boolean(row.is_scanned || localMeta.isScanned);
      const rowHasValidRow = row.warehouse_row && row.warehouse_row !== 'Sin Asignar';
      const prevHasValidRow = prev?.warehouse_row && prev.warehouse_row !== 'Sin Asignar';

      consolidatedBySerial.set(serial, {
        serial_number: serial,
        material_model:
          (row.material_model && row.material_model !== 'Sin Modelo' && row.material_model !== 'MODELO GENERAL'
            ? row.material_model
            : null) ||
          prev?.material_model ||
          row.material_model ||
          localMeta.material ||
          'MODELO GENERAL',
        is_scanned: Boolean(prev?.is_scanned || rowScanned),
        scanned_at: prev?.scanned_at || row.scanned_at || (rowScanned ? nowIso : null),
        warehouse_name: prev?.warehouse_name || row.warehouse_name || localMeta.warehouseName || 'Almacén 1',
        warehouse_row:
          (prevHasValidRow ? prev.warehouse_row : null) ||
          (rowHasValidRow ? row.warehouse_row : null) ||
          localMeta.warehouseRow ||
          prev?.warehouse_row ||
          row.warehouse_row ||
          'Sin Asignar',
        warehouse_space: prev?.warehouse_space || row.warehouse_space || localMeta.warehouseSpace || '',
        internal_number: prev?.internal_number ?? row.internal_number ?? localMeta.internalNumber ?? null,
        printer_status: prev?.printer_status || row.printer_status || 'DISPONIBLE|Principal',
        document_name: prev?.document_name || row.document_name || localMeta.documentName || null
      });
    }

    // 4. Determinar qué series formarán parte del checklist fusionado y cruzar con unexpected_logs
    const finalMergedMap = new Map();
    let autoMatchedFromErrors = 0;
    const matchedErrorSerials = new Set();

    for (const [serial, info] of consolidatedBySerial.entries()) {
      if (mode === 'BASE_LIST' && !baseChecklistSerials.has(serial) && !info.is_scanned) {
        continue;
      }

      const mergedInfo = { ...info };

      // Si no estaba marcada como escaneada pero el operador ya la había escaneado y estaba en unexpected_logs,
      // marcarla automáticamente como escaneada/verificada (correspondencia encontrada)
      if (unexpectedBySerial.has(serial)) {
        const unexp = unexpectedBySerial.get(serial);
        if (!mergedInfo.is_scanned) {
          mergedInfo.is_scanned = true;
          mergedInfo.scanned_at = unexp.createdAt || nowIso;
          if ((!mergedInfo.warehouse_row || mergedInfo.warehouse_row === 'Sin Asignar') && unexp.extraRow) {
            mergedInfo.warehouse_row = unexp.extraRow;
          }
          autoMatchedFromErrors++;
        }
        matchedErrorSerials.add(serial);
      }

      finalMergedMap.set(serial, mergedInfo);

      // Actualizar caché local si está escaneada
      if (mergedInfo.is_scanned) {
        cache.serials[serial] = {
          ...(cache.serials[serial] || {}),
          material: mergedInfo.material_model,
          isScanned: true,
          warehouseName: mergedInfo.warehouse_name,
          warehouseRow: mergedInfo.warehouse_row,
          warehouseSpace: mergedInfo.warehouse_space,
          internalNumber: mergedInfo.internal_number,
          status: (mergedInfo.printer_status || 'DISPONIBLE').split('|')[0] || 'DISPONIBLE'
        };
      }
    }

    this.saveMetadataCache(cache);

    // 5. Aplicar actualizaciones e inserciones en el checklist destino (`targetChecklistId`)
    const toInsert = [];
    const toUpdatePromises = [];

    for (const [serial, mergedInfo] of finalMergedMap.entries()) {
      const existingTargetRow = targetExistingBySerial.get(serial);
      if (existingTargetRow) {
        if (
          Boolean(existingTargetRow.is_scanned) !== Boolean(mergedInfo.is_scanned) ||
          existingTargetRow.warehouse_row !== mergedInfo.warehouse_row ||
          existingTargetRow.warehouse_space !== mergedInfo.warehouse_space ||
          existingTargetRow.internal_number !== mergedInfo.internal_number
        ) {
          toUpdatePromises.push(
            supabase
              .from('expected_series')
              .update({
                is_scanned: mergedInfo.is_scanned,
                scanned_at: mergedInfo.scanned_at,
                warehouse_name: mergedInfo.warehouse_name,
                warehouse_row: mergedInfo.warehouse_row,
                warehouse_space: mergedInfo.warehouse_space,
                internal_number: mergedInfo.internal_number
              })
              .eq('id', existingTargetRow.id)
          );
        }
      } else {
        toInsert.push({
          checklist_id: targetChecklistId,
          serial_number: serial,
          material_model: mergedInfo.material_model,
          is_scanned: mergedInfo.is_scanned,
          scanned_at: mergedInfo.scanned_at,
          warehouse_name: mergedInfo.warehouse_name,
          warehouse_row: mergedInfo.warehouse_row,
          warehouse_space: mergedInfo.warehouse_space,
          internal_number: mergedInfo.internal_number
        });
      }
    }

    // Si en modo BASE_LIST quedaron filas no escaneadas en targetChecklistId que no están en finalMergedMap, removerlas
    if (mode === 'BASE_LIST') {
      const idsToDeleteFromTarget = [];
      for (const [serial, row] of targetExistingBySerial.entries()) {
        if (!finalMergedMap.has(serial) && !row.is_scanned) {
          idsToDeleteFromTarget.push(row.id);
        }
      }
      if (idsToDeleteFromTarget.length > 0) {
        await supabase.from('expected_series').delete().in('id', idsToDeleteFromTarget);
      }
    }

    if (toUpdatePromises.length > 0) {
      const CHUNK = 50;
      for (let i = 0; i < toUpdatePromises.length; i += CHUNK) {
        await Promise.allSettled(toUpdatePromises.slice(i, i + CHUNK));
      }
    }

    if (toInsert.length > 0) {
      const CHUNK = 400;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const { error: insErr } = await supabase.from('expected_series').insert(chunk);
        if (insErr) {
          const fallbackChunk = chunk.map(item => ({
            checklist_id: item.checklist_id,
            serial_number: item.serial_number,
            material_model: item.material_model,
            is_scanned: item.is_scanned,
            scanned_at: item.scanned_at,
            warehouse_row: item.warehouse_row
          }));
          await supabase.from('expected_series').insert(fallbackChunk);
        }
      }
    }

    // 6. Sincronizar unexpected_logs: conservar solo los que NO hicieron match con ninguna serie esperada
    const remainingUnexpectedValues = [];
    const seenRemainingUnexp = new Set();
    for (const u of rawUnexpectedList) {
      if (!matchedErrorSerials.has(u.cleanSerial) && !finalMergedMap.has(u.cleanSerial)) {
        if (!seenRemainingUnexp.has(u.rawVal)) {
          seenRemainingUnexp.add(u.rawVal);
          remainingUnexpectedValues.push({
            checklist_id: targetChecklistId,
            scanned_value: u.rawVal
          });
        }
      }
    }

    try {
      await supabase.from('unexpected_logs').delete().in('checklist_id', allIds);
      if (remainingUnexpectedValues.length > 0) {
        await supabase.from('unexpected_logs').insert(remainingUnexpectedValues);
      }
    } catch (e) {
      console.warn('Advertencia actualizando unexpected_logs tras fusión:', e);
    }

    // 7. Eliminar los checklists origen absorbidos para evitar duplicidad
    if (deleteSources && cleanSources.length > 0) {
      try {
        await supabase.from('expected_series').delete().in('checklist_id', cleanSources);
        await supabase.from('checklists').delete().in('id', cleanSources);
      } catch (e) {
        console.warn('Advertencia eliminando checklists origen tras fusión:', e);
      }
    }

    // 8. Actualizar estado del checklist destino según su avance
    let totalScanned = 0;
    for (const info of finalMergedMap.values()) {
      if (info.is_scanned) totalScanned++;
    }
    const newStatus = finalMergedMap.size > 0 && totalScanned >= finalMergedMap.size ? 'completed' : 'pending';
    try {
      await supabase.from('checklists').update({ status: newStatus }).eq('id', targetChecklistId);
    } catch (e) {
      console.warn('No se pudo actualizar estado del checklist fusionado:', e);
    }

    return {
      targetChecklistId,
      totalSeries: finalMergedMap.size,
      totalScanned,
      autoMatchedFromErrors,
      remainingErrors: remainingUnexpectedValues.length
    };
  }

  /**
   * Fusiona una lista de series recién leídas de un archivo PDF/Excel directamente dentro de un checklist existente en curso,
   * conservando todo lo escaneado y cruzando automáticamente las lecturas que estaban en error (`unexpected_logs`).
   */
  static async mergeSeriesIntoChecklist(targetChecklistId, newSeries = [], mode = 'UNION') {
    if (!targetChecklistId || !newSeries || newSeries.length === 0) {
      throw new Error('Datos insuficientes para fusionar con el checklist.');
    }

    const nowIso = new Date().toISOString();
    const cache = this.getMetadataCache();
    cache.serials = cache.serials || {};

    const { data: existingRows, error: exErr } = await supabase
      .from('expected_series')
      .select('*')
      .eq('checklist_id', targetChecklistId);

    if (exErr) {
      throw new Error(`Error consultando el checklist destino: ${exErr.message}`);
    }

    const { data: dbUnexpected } = await supabase
      .from('unexpected_logs')
      .select('*')
      .eq('checklist_id', targetChecklistId);

    const unexpectedBySerial = new Map();
    for (const log of (dbUnexpected || [])) {
      const rawVal = String(log.scanned_value || '').trim().toUpperCase();
      if (!rawVal) continue;
      const parts = rawVal.split('|');
      const cleanSerial = parts[0].trim();
      const extraRow = parts[1] ? parts[1].trim() : null;
      if (cleanSerial && !unexpectedBySerial.has(cleanSerial)) {
        unexpectedBySerial.set(cleanSerial, {
          rawVal,
          cleanSerial,
          extraRow,
          createdAt: log.created_at || nowIso
        });
      }
    }

    const existingMap = new Map();
    for (const row of (existingRows || [])) {
      const s = String(row.serial_number || '').trim().toUpperCase();
      if (s) existingMap.set(s, row);
    }

    const incomingMap = new Map();
    for (const item of newSeries) {
      const s = String(item.serial || '').trim().toUpperCase();
      if (s && !incomingMap.has(s)) {
        incomingMap.set(s, item);
      }
    }

    const toInsert = [];
    const toUpdatePromises = [];
    const matchedErrorSerials = new Set();
    let autoMatchedFromErrors = 0;

    // Procesar todas las series del nuevo documento
    for (const [serial, item] of incomingMap.entries()) {
      const existingRow = existingMap.get(serial);
      const unexp = unexpectedBySerial.get(serial);

      if (existingRow) {
        if (!existingRow.is_scanned && unexp) {
          autoMatchedFromErrors++;
          matchedErrorSerials.add(serial);
          toUpdatePromises.push(
            supabase
              .from('expected_series')
              .update({
                is_scanned: true,
                scanned_at: unexp.createdAt || nowIso,
                warehouse_row: existingRow.warehouse_row && existingRow.warehouse_row !== 'Sin Asignar'
                  ? existingRow.warehouse_row
                  : (unexp.extraRow || 'Sin Asignar')
              })
              .eq('id', existingRow.id)
          );
        }
      } else {
        const isMatchedError = Boolean(unexp);
        if (isMatchedError) {
          autoMatchedFromErrors++;
          matchedErrorSerials.add(serial);
        }
        toInsert.push({
          checklist_id: targetChecklistId,
          serial_number: serial,
          material_model: item.material || 'MODELO GENERAL',
          is_scanned: isMatchedError,
          scanned_at: isMatchedError ? (unexp.createdAt || nowIso) : null,
          warehouse_row: isMatchedError && unexp.extraRow ? unexp.extraRow : 'Sin Asignar'
        });
      }
    }

    // Si algún registro existente en el checklist ya había sido escaneado en unexpected_logs (por si acaso)
    for (const [serial, existingRow] of existingMap.entries()) {
      if (!existingRow.is_scanned && unexpectedBySerial.has(serial) && !matchedErrorSerials.has(serial)) {
        const unexp = unexpectedBySerial.get(serial);
        autoMatchedFromErrors++;
        matchedErrorSerials.add(serial);
        toUpdatePromises.push(
          supabase
            .from('expected_series')
            .update({
              is_scanned: true,
              scanned_at: unexp.createdAt || nowIso
            })
            .eq('id', existingRow.id)
        );
      }
    }

    // Si el modo es BASE_LIST (actualizar lista con el nuevo PDF), eliminar las series no escaneadas que no vengan en el nuevo PDF
    if (mode === 'BASE_LIST') {
      const idsToRemove = [];
      for (const [serial, existingRow] of existingMap.entries()) {
        if (!incomingMap.has(serial) && !existingRow.is_scanned && !matchedErrorSerials.has(serial)) {
          idsToRemove.push(existingRow.id);
        }
      }
      if (idsToRemove.length > 0) {
        await supabase.from('expected_series').delete().in('id', idsToRemove);
      }
    }

    if (toUpdatePromises.length > 0) {
      await Promise.allSettled(toUpdatePromises);
    }

    if (toInsert.length > 0) {
      const CHUNK = 400;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        await supabase.from('expected_series').insert(toInsert.slice(i, i + CHUNK));
      }
    }

    if (matchedErrorSerials.size > 0) {
      const rawValsToDelete = [];
      for (const s of matchedErrorSerials) {
        const u = unexpectedBySerial.get(s);
        if (u) rawValsToDelete.push(u.rawVal);
        rawValsToDelete.push(s);
      }
      await supabase
        .from('unexpected_logs')
        .delete()
        .eq('checklist_id', targetChecklistId)
        .in('scanned_value', rawValsToDelete);
    }

    return {
      targetChecklistId,
      addedCount: toInsert.length,
      autoMatchedFromErrors
    };
  }
}
