import { supabase } from '../utils/supabaseClient.js';

const QUEUE_STORAGE_KEY = 'cdm_offline_sync_queue_v2';
const SNAPSHOT_CHECKLISTS_KEY = 'cdm_offline_checklists_snapshot_v1';
const SNAPSHOT_ML_KEY = 'cdm_offline_ml_snapshot_v1';

/**
 * Servicio Centralizado de Sincronización Fuera de Línea (Offline Sync Engine)
 * 
 * Permite a los operadores en bodega/camión seguir escaneando y registrando impresoras
 * aunque se pierda el Wi-Fi. Las lecturas se guardan localmente en el dispositivo
 * y se suben automáticamente a Supabase en cuanto se restablece la conexión.
 */
class OfflineSyncServiceImpl {
  constructor() {
    this.isSyncing = false;
    this.syncCompleteCallbacks = new Set();
    this.debounceTimer = null;

    if (typeof window !== 'undefined') {
      this.initListeners();
    }
  }

  /**
   * Configura detectores de eventos de red y temporizadores
   */
  initListeners() {
    // Al volver la conexión a internet
    window.addEventListener('online', () => {
      console.log('📶 Conexión Wi-Fi / Internet restablecida. Iniciando sincronización de cola offline...');
      this.notifyListeners();
      this.scheduleSync(500);
    });

    // Al perder la conexión
    window.addEventListener('offline', () => {
      console.warn('📶 Se perdió la conexión Wi-Fi / Internet. Activando modo fuera de línea local.');
      this.notifyListeners();
    });

    // Al volver a la pestaña o reactivar la pantalla del celular
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isOnline() && this.getPendingCount() > 0) {
        this.scheduleSync(1000);
      }
    });

    // Verificación periódica en segundo plano cada 12 segundos
    setInterval(() => {
      if (this.isOnline() && this.getPendingCount() > 0 && !this.isSyncing) {
        this.processQueue();
      }
    }, 12000);
  }

  isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * Obtiene la cola de operaciones pendientes desde localStorage
   */
  getQueue() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Error leyendo cola offline de localStorage:', e);
      return [];
    }
  }

  /**
   * Guarda la cola de operaciones en localStorage
   */
  saveQueue(queue) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
      }
    } catch (e) {
      console.warn('Error guardando cola offline en localStorage:', e);
    }
    this.notifyListeners();
  }

  /**
   * Número de operaciones pendientes de sincronizar
   */
  getPendingCount() {
    return this.getQueue().length;
  }

  /**
   * Notifica a componentes UI suscritos
   */
  notifyListeners() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cdm_offline_sync_change', {
        detail: {
          pendingCount: this.getPendingCount(),
          isOnline: this.isOnline(),
          isSyncing: this.isSyncing
        }
      }));
    }
  }

  /**
   * Registra un callback que se ejecuta tras una sincronización exitosa
   */
  onSyncComplete(callback) {
    if (typeof callback === 'function') {
      this.syncCompleteCallbacks.add(callback);
    }
    return () => this.syncCompleteCallbacks.delete(callback);
  }

  /**
   * Programa una sincronización debounced
   */
  scheduleSync(delayMs = 1000) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processQueue();
    }, delayMs);
  }

  /**
   * Agrega una operación a la cola offline.
   * Si ya existía una operación pendiente para la misma serie en el mismo checklist, la actualiza.
   */
  addToQueue(actionType, payload) {
    const queue = this.getQueue();
    const nowIso = new Date().toISOString();

    // Deduplicación para escaneo de series: si ya estaba pendiente la misma serie, actualizar datos
    if (actionType === 'REGISTER_SCAN' && payload.serialNumber && payload.checklistId) {
      const existingIdx = queue.findIndex(
        it => it.type === 'REGISTER_SCAN' &&
              it.payload?.serialNumber === payload.serialNumber &&
              it.payload?.checklistId === payload.checklistId
      );
      if (existingIdx !== -1) {
        queue[existingIdx].payload = { ...queue[existingIdx].payload, ...payload, scannedAt: nowIso };
        queue[existingIdx].timestamp = nowIso;
        this.saveQueue(queue);
        if (this.isOnline()) this.scheduleSync(1200);
        return queue[existingIdx].id;
      }
    }

    if (actionType === 'ASSIGN_LOCATION' && payload.serialNumber) {
      const existingIdx = queue.findIndex(
        it => it.type === 'ASSIGN_LOCATION' && it.payload?.serialNumber === payload.serialNumber
      );
      if (existingIdx !== -1) {
        queue[existingIdx].payload = { ...queue[existingIdx].payload, ...payload, scannedAt: nowIso };
        queue[existingIdx].timestamp = nowIso;
        this.saveQueue(queue);
        if (this.isOnline()) this.scheduleSync(1200);
        return queue[existingIdx].id;
      }
    }

    const item = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: actionType,
      payload: { ...payload },
      timestamp: nowIso,
      retries: 0
    };

    queue.push(item);
    this.saveQueue(queue);

    console.log(`[OfflineQueue] Operación "${actionType}" agregada a la cola offline (Total pendientes: ${queue.length})`);

    // Si hay conexión, intentar enviarla de inmediato en segundo plano
    if (this.isOnline()) {
      this.scheduleSync(1000);
    }

    return item.id;
  }

  /**
   * Ejecuta la sincronización de todas las operaciones pendientes con Supabase
   */
  async processQueue() {
    if (this.isSyncing) return { inProgress: true };

    if (!this.isOnline()) {
      console.log('[OfflineQueue] Sin conexión a internet. Omitiendo proceso de cola.');
      return { inProgress: false, reason: 'offline' };
    }

    const queue = this.getQueue();
    if (queue.length === 0) {
      return { inProgress: false, processedCount: 0 };
    }

    this.isSyncing = true;
    this.notifyListeners();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cdm_offline_sync_start', {
        detail: { total: queue.length }
      }));
    }

    console.log(`[OfflineQueue] Iniciando subida de ${queue.length} operaciones acumuladas hacia Supabase...`);

    let syncedCount = 0;
    const remainingQueue = [...queue];

    try {
      while (remainingQueue.length > 0) {
        const currentItem = remainingQueue[0];
        let success = false;

        try {
          success = await this.executeQueueItem(currentItem);
        } catch (itemErr) {
          console.error(`[OfflineQueue] Error ejecutando operación ${currentItem.type}:`, itemErr);
          // Si el error parece de desconexión de red, pausar para no quemar intentos
          if (!this.isOnline() || itemErr.message?.includes('Failed to fetch') || itemErr.message?.includes('NetworkError')) {
            currentItem.retries = (currentItem.retries || 0) + 1;
            break;
          }
          // Si es un error de datos irrecuperable y ya tiene más de 4 intentos, descartar para no atascar la cola
          currentItem.retries = (currentItem.retries || 0) + 1;
          if (currentItem.retries >= 5) {
            console.warn(`[OfflineQueue] Descartando operación ${currentItem.id} tras 5 intentos fallidos:`, currentItem);
            success = true; // Descartar de la cola
          }
        }

        if (success) {
          remainingQueue.shift();
          syncedCount++;
          // Guardar progreso intermedio en localStorage por seguridad
          this.saveQueue(remainingQueue);
        } else {
          // Si falló por red, salir del bucle y esperar al siguiente intento
          break;
        }
      }
    } finally {
      this.saveQueue(remainingQueue);
      this.isSyncing = false;
      this.notifyListeners();

      const result = {
        syncedCount,
        remainingCount: remainingQueue.length
      };

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cdm_offline_sync_end', {
          detail: result
        }));
      }

      if (syncedCount > 0) {
        console.log(`[OfflineQueue] ✓ ¡${syncedCount} operaciones sincronizadas con éxito con Supabase!`);
        for (const cb of this.syncCompleteCallbacks) {
          try {
            cb(result);
          } catch (cbErr) {
            console.error('Error en callback de sincronización:', cbErr);
          }
        }
      }
    }

    return { processedCount: syncedCount, remaining: remainingQueue.length };
  }

  /**
   * Ejecuta individualmente una operación contra Supabase
   */
  async executeQueueItem(item) {
    const { type, payload } = item;

    switch (type) {
      case 'REGISTER_SCAN': {
        const { checklistId, serialNumber, warehouseRow, internalNumber, scannedAt } = payload;
        const numVal = internalNumber !== null && internalNumber !== undefined && !isNaN(Number(internalNumber))
          ? Number(internalNumber)
          : null;

        const updatePayload = {
          is_scanned: true,
          scanned_at: scannedAt || new Date().toISOString(),
          warehouse_row: warehouseRow || 'Sin Asignar'
        };
        if (numVal !== null) {
          updatePayload.internal_number = numVal;
        }

        const { error: fullError } = await supabase
          .from('expected_series')
          .update(updatePayload)
          .eq('checklist_id', checklistId)
          .eq('serial_number', serialNumber);

        if (fullError) {
          // Fallback sin internal_number
          const { error: fbErr } = await supabase
            .from('expected_series')
            .update({
              is_scanned: true,
              scanned_at: scannedAt || new Date().toISOString(),
              warehouse_row: warehouseRow || 'Sin Asignar'
            })
            .eq('checklist_id', checklistId)
            .eq('serial_number', serialNumber);

          if (fbErr) throw fbErr;
        }
        return true;
      }

      case 'ASSIGN_LOCATION': {
        const {
          serialNumber,
          warehouseName = 'Almacén 1',
          warehouseRow = 'Fila 1',
          warehouseSpace = '',
          internalNumber = null,
          systemStatus = 'Principal',
          scannedAt
        } = payload;

        const numVal = internalNumber !== null && internalNumber !== undefined && !isNaN(Number(internalNumber))
          ? Number(internalNumber)
          : null;

        const encodedStatus = `DISPONIBLE|${systemStatus || 'Principal'}`;

        const { error: mainErr } = await supabase
          .from('expected_series')
          .update({
            warehouse_name: warehouseName,
            warehouse_row: warehouseRow,
            warehouse_space: warehouseSpace,
            internal_number: numVal,
            printer_status: encodedStatus,
            system_status: systemStatus || 'Principal',
            is_scanned: true,
            scanned_at: scannedAt || new Date().toISOString()
          })
          .eq('serial_number', serialNumber);

        if (mainErr) {
          // Fallback sin columna system_status
          const { error: fallbackErr } = await supabase
            .from('expected_series')
            .update({
              warehouse_name: warehouseName,
              warehouse_row: warehouseRow,
              warehouse_space: warehouseSpace,
              internal_number: numVal,
              printer_status: encodedStatus,
              is_scanned: true,
              scanned_at: scannedAt || new Date().toISOString()
            })
            .eq('serial_number', serialNumber);

          if (fallbackErr) throw fallbackErr;
        }
        return true;
      }

      case 'LOG_UNEXPECTED': {
        const { checklistId, serialNumber } = payload;
        const { error } = await supabase
          .from('unexpected_logs')
          .insert({
            checklist_id: checklistId,
            scanned_value: serialNumber
          });
        if (error) throw error;
        return true;
      }

      case 'MARK_CHECKLIST_COMPLETED': {
        const { checklistId } = payload;
        const { error } = await supabase
          .from('checklists')
          .update({ status: 'completed' })
          .eq('id', checklistId);
        if (error) throw error;
        return true;
      }

      case 'UPDATE_INTERNAL_NUMBER': {
        const { serialNumber, internalNumber } = payload;
        const numVal = !isNaN(Number(internalNumber)) ? Number(internalNumber) : null;
        const { error } = await supabase
          .from('expected_series')
          .update({ internal_number: numVal })
          .eq('serial_number', serialNumber);
        if (error) throw error;
        return true;
      }

      case 'UPDATE_PRINTER_STATUS': {
        const { serialNumber, newStatus } = payload;
        const { error } = await supabase
          .from('expected_series')
          .update({ printer_status: newStatus })
          .eq('serial_number', serialNumber);
        if (error) throw error;
        return true;
      }

      case 'ML_REGISTER_SCAN': {
        const { itemId, scannedAt, scannedWith = 'gun' } = payload;
        const idStr = String(itemId || '');
        if (idStr.startsWith('local_item_')) return true; // Items puramente locales

        const { error } = await supabase
          .from('mercadolibre_items')
          .update({
            is_scanned: true,
            scanned_at: scannedAt,
            scanned_with: scannedWith
          })
          .eq('id', itemId);

        if (error) {
          // Fallback en tabla expected_series
          await supabase
            .from('expected_series')
            .update({
              is_scanned: true,
              scanned_at: scannedAt,
              warehouse_space: scannedWith
            })
            .eq('id', itemId);
        }
        return true;
      }

      case 'ML_LOG_UNEXPECTED': {
        const { batchId, value } = payload;
        try {
          await supabase
            .from('mercadolibre_unexpected')
            .insert({
              batch_id: batchId,
              scanned_value: value
            });
        } catch {
          await supabase
            .from('unexpected_logs')
            .insert({
              checklist_id: batchId,
              scanned_value: value
            });
        }
        return true;
      }

      case 'ML_MARK_COMPLETED': {
        const { batchId } = payload;
        try {
          await supabase
            .from('mercadolibre_batches')
            .update({ status: 'completed' })
            .eq('id', batchId);
        } catch {
          await supabase
            .from('checklists')
            .update({ status: 'completed' })
            .eq('id', batchId);
        }
        return true;
      }

      default:
        console.warn(`[OfflineQueue] Tipo de operación desconocido: ${type}`, payload);
        return true; // Descartar para no bloquear la cola
    }
  }

  // --- RESPALDO DE INSTANTÁNEAS (SNAPSHOTS) PARA MODO OFFLINE AL RECARGAR PÁGINA ---

  saveChecklistsSnapshot(checklists) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(SNAPSHOT_CHECKLISTS_KEY, JSON.stringify(checklists || []));
      }
    } catch (e) {
      console.warn('Error guardando snapshot de checklists:', e);
    }
  }

  getChecklistsSnapshot() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(SNAPSHOT_CHECKLISTS_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Error recuperando snapshot de checklists:', e);
      return [];
    }
  }

  saveMlSnapshot(batches) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(SNAPSHOT_ML_KEY, JSON.stringify(batches || []));
      }
    } catch (e) {
      console.warn('Error guardando snapshot de Mercado Libre:', e);
    }
  }

  getMlSnapshot() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(SNAPSHOT_ML_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Error recuperando snapshot de Mercado Libre:', e);
      return [];
    }
  }
}

export const OfflineSyncService = new OfflineSyncServiceImpl();
