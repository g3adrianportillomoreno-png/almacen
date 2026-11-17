import { supabase } from '../utils/supabaseClient.js';
import { InventoryRepository } from './InventoryRepository.js';
import { RealtimeSyncService } from './RealtimeSyncService.js';

const DB_NAME = 'cdm_checkpoints_db_v1';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints_store';
const META_KEY = 'cdm_checkpoints_meta_v1';

export const CHECKPOINT_PASSWORD = 'Hola_Mundo!';
export const TOTAL_SLOTS = 5;

/**
 * Helper interno para abrir y gestionar IndexedDB sin dependencias externas
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB no está disponible en este entorno.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Error leyendo de IndexedDB:', e);
    return null;
  }
}

async function idbPut(record) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Error guardando en IndexedDB:', e);
    return false;
  }
}

async function idbDelete(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Error eliminando de IndexedDB:', e);
    return false;
  }
}

function getLocalMeta() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalMeta(meta) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    }
  } catch (e) {
    console.warn('Error guardando metadata de checkpoints:', e);
  }
}

/**
 * Servicio Centralizado de Checkpoints (Puntos de Restauración Manuales)
 * Maneja exactamente 5 espacios independientes para Inventario Maestro y para Recepciones.
 */
export class CheckpointService {
  /**
   * Valida la contraseña obligatoria de restauración
   */
  static verifyPassword(password) {
    return (password || '').trim() === CHECKPOINT_PASSWORD;
  }

  /**
   * Obtiene la lista estructurada de los 5 slots para una categoría ('MASTER' o 'RECEPTIONS')
   */
  static async getSlots(category) {
    const safeCategory = category.toUpperCase();
    const meta = getLocalMeta();

    // Intentar sincronizar metadatos desde Supabase si la tabla existe
    try {
      const { data: cloudData, error } = await supabase
        .from('system_checkpoints')
        .select('id, category, slot_index, name, item_count, created_at, updated_at')
        .eq('category', safeCategory);

      if (!error && Array.isArray(cloudData)) {
        for (const row of cloudData) {
          meta[row.id] = {
            id: row.id,
            category: row.category,
            slotIndex: row.slot_index,
            name: row.name,
            itemCount: row.item_count,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }
        saveLocalMeta(meta);
      }
    } catch {
      // Supabase offline o tabla no creada aún; usar datos locales
    }

    const slots = [];
    for (let i = 1; i <= TOTAL_SLOTS; i++) {
      const slotId = `${safeCategory}_${i}`;
      const slotMeta = meta[slotId];
      if (slotMeta) {
        slots.push({
          slotIndex: i,
          id: slotId,
          isEmpty: false,
          name: slotMeta.name || `Punto de Restauración #${i}`,
          itemCount: slotMeta.itemCount || 0,
          createdAt: slotMeta.createdAt || new Date().toISOString(),
          updatedAt: slotMeta.updatedAt || slotMeta.createdAt
        });
      } else {
        slots.push({
          slotIndex: i,
          id: slotId,
          isEmpty: true,
          name: '',
          itemCount: 0,
          createdAt: null
        });
      }
    }
    return slots;
  }

  /**
   * Guarda un checkpoint en el slot especificado (1 al 5)
   * @param {string} category 'MASTER' | 'RECEPTIONS'
   * @param {number} slotIndex 1..5
   * @param {string} name Etiqueta o nombre del checkpoint
   * @param {any} snapshotData Datos completos del snapshot
   * @param {number} itemCount Conteo de registros respaldados
   */
  static async saveCheckpoint(category, slotIndex, name, snapshotData, itemCount) {
    const safeCategory = category.toUpperCase();
    if (slotIndex < 1 || slotIndex > TOTAL_SLOTS) {
      throw new Error(`El número de espacio debe estar entre 1 y ${TOTAL_SLOTS}`);
    }

    const slotId = `${safeCategory}_${slotIndex}`;
    const nowIso = new Date().toISOString();
    const finalName = (name || '').trim() || `Punto #${slotIndex} (${new Date().toLocaleDateString('es-MX')})`;

    const record = {
      id: slotId,
      category: safeCategory,
      slot_index: slotIndex,
      name: finalName,
      item_count: itemCount || 0,
      data: snapshotData,
      created_at: nowIso,
      updated_at: nowIso
    };

    // 1. Guardar en IndexedDB localmente
    await idbPut(record);

    // 2. Guardar en metadata ligera local
    const meta = getLocalMeta();
    meta[slotId] = {
      id: slotId,
      category: safeCategory,
      slotIndex: slotIndex,
      name: finalName,
      itemCount: itemCount || 0,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    saveLocalMeta(meta);

    // 3. Intentar sincronizar en Supabase si la tabla existe
    try {
      await supabase
        .from('system_checkpoints')
        .upsert({
          id: slotId,
          category: safeCategory,
          slot_index: slotIndex,
          name: finalName,
          item_count: itemCount || 0,
          data: snapshotData,
          created_at: nowIso,
          updated_at: nowIso
        });
    } catch (e) {
      console.warn('Nota: Sincronización en la nube de checkpoint no disponible o pendiente de migración SQL:', e);
    }

    return meta[slotId];
  }

  /**
   * Elimina/Libera un slot de checkpoint
   */
  static async deleteCheckpoint(category, slotIndex) {
    const safeCategory = category.toUpperCase();
    const slotId = `${safeCategory}_${slotIndex}`;

    // 1. Eliminar de IndexedDB
    await idbDelete(slotId);

    // 2. Eliminar de metadata local
    const meta = getLocalMeta();
    delete meta[slotId];
    saveLocalMeta(meta);

    // 3. Eliminar de Supabase si existe
    try {
      await supabase
        .from('system_checkpoints')
        .delete()
        .eq('id', slotId);
    } catch {
      // Ignorar si falla
    }
    return true;
  }

  /**
   * Obtiene el snapshot completo guardado en un slot
   */
  static async getCheckpointData(category, slotIndex) {
    const safeCategory = category.toUpperCase();
    const slotId = `${safeCategory}_${slotIndex}`;

    // 1. Intentar leer de IndexedDB local
    let record = await idbGet(slotId);
    if (record && record.data) {
      return record;
    }

    // 2. Si no está en IndexedDB local (ej. se creó en otra PC), intentar descargar de Supabase
    try {
      const { data, error } = await supabase
        .from('system_checkpoints')
        .select('*')
        .eq('id', slotId)
        .maybeSingle();

      if (!error && data && data.data) {
        // Cachear en IndexedDB local para lecturas futuras
        await idbPut(data);
        return data;
      }
    } catch (e) {
      console.warn('Error leyendo checkpoint desde Supabase:', e);
    }

    return null;
  }

  /**
   * RESTAURACIÓN DEL ARCHIVO MAESTRO
   * Reemplaza el inventario maestro con el snapshot sin tocar recepciones pendientes.
   */
  static async restoreMasterCheckpoint(slotIndex, password) {
    if (!this.verifyPassword(password)) {
      throw new Error('Contraseña incorrecta. Se requiere autorización para restaurar este checkpoint.');
    }

    const checkpoint = await this.getCheckpointData('MASTER', slotIndex);
    if (!checkpoint || !checkpoint.data || !Array.isArray(checkpoint.data.printers)) {
      throw new Error(`El Espacio #${slotIndex} no contiene datos válidos para restaurar.`);
    }

    const restoredPrinters = checkpoint.data.printers;

    // 1. Obtener o crear el checklist contenedor 'Inventario Maestro'
    let defaultBatchId = null;
    try {
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
    } catch (e) {
      console.warn('Error localizando lote maestro para restauración:', e);
    }

    // 2. Limpiar las series actuales del lote de Inventario Maestro en Supabase
    if (defaultBatchId) {
      try {
        await supabase
          .from('expected_series')
          .delete()
          .eq('checklist_id', defaultBatchId);
      } catch (e) {
        console.warn('Error limpiando series previas del maestro:', e);
      }
    }

    // 3. Reinsertar en bloques las impresoras del checkpoint
    if (defaultBatchId && restoredPrinters.length > 0) {
      const CHUNK_SIZE = 80;
      for (let i = 0; i < restoredPrinters.length; i += CHUNK_SIZE) {
        const chunk = restoredPrinters.slice(i, i + CHUNK_SIZE).map(p => ({
          checklist_id: defaultBatchId,
          serial_number: (p.serial || '').trim().toUpperCase(),
          material_model: p.material || 'MODELO GENERAL',
          internal_number: p.internalNumber !== undefined && p.internalNumber !== null && String(p.internalNumber).trim() !== '' 
            ? (!isNaN(Number(p.internalNumber)) ? Number(p.internalNumber) : null) 
            : null,
          warehouse_name: p.warehouseName || 'Almacén 1',
          warehouse_row: p.warehouseRow || 'Sin Asignar',
          warehouse_space: p.warehouseSpace || null,
          system_status: p.systemStatus || 'Principal',
          printer_status: p.printerStatus || p.status || 'DISPONIBLE',
          assigned_at: p.assignedAt || new Date().toISOString(),
          is_scanned: true,
          scanned_at: p.assignedAt || new Date().toISOString()
        }));

        try {
          await supabase.from('expected_series').insert(chunk);
        } catch (err) {
          console.error('Error insertando bloque restaurado en expected_series:', err);
        }
      }
    }

    // 4. Restaurar la caché local de metadatos de series
    if (checkpoint.data.serialsCache) {
      const cache = InventoryRepository.getMetadataCache();
      cache.serials = checkpoint.data.serialsCache;
      InventoryRepository.saveMetadataCache(cache);
    }

    // 5. Notificar a través de sincronización en tiempo real
    try {
      RealtimeSyncService.notifyChange('restore_master_checkpoint');
    } catch {
      // Ignorar si no está conectado
    }

    return {
      success: true,
      restoredCount: restoredPrinters.length,
      name: checkpoint.name
    };
  }

  /**
   * RESTAURACIÓN DE RECEPCIONES (CHECKLISTS)
   * Restaura los lotes de recepción, series y logs inesperados sin mover ubicaciones físicas del maestro.
   */
  static async restoreReceptionsCheckpoint(slotIndex, password) {
    if (!this.verifyPassword(password)) {
      throw new Error('Contraseña incorrecta. Se requiere autorización para restaurar este checkpoint.');
    }

    const checkpoint = await this.getCheckpointData('RECEPTIONS', slotIndex);
    if (!checkpoint || !checkpoint.data || !Array.isArray(checkpoint.data.batches)) {
      throw new Error(`El Espacio #${slotIndex} no contiene recepciones válidas para restaurar.`);
    }

    const restoredBatches = checkpoint.data.batches;

    // 1. Obtener los IDs de todos los checklists de recepción actuales (excluyendo el Maestro)
    let currentReceptionIds = [];
    try {
      const { data: currentChecklists } = await supabase
        .from('checklists')
        .select('id, name, folio');

      if (currentChecklists && currentChecklists.length > 0) {
        currentReceptionIds = currentChecklists
          .filter(ch => {
            const nm = (ch.name || '').toLowerCase();
            const fl = (ch.folio || '').toUpperCase();
            return !nm.includes('inventario maestro') && fl !== 'MAESTRO' && !nm.startsWith('[ml-');
          })
          .map(ch => ch.id);
      }
    } catch (e) {
      console.warn('Error consultando checklists actuales de recepción:', e);
    }

    // 2. Eliminar series y logs de las recepciones actuales (el maestro NO se toca)
    if (currentReceptionIds.length > 0) {
      try {
        await supabase.from('unexpected_logs').delete().in('checklist_id', currentReceptionIds);
      } catch (e) {
        console.warn('Error eliminando unexpected_logs previos:', e);
      }
      try {
        await supabase.from('expected_series').delete().in('checklist_id', currentReceptionIds);
      } catch (e) {
        console.warn('Error eliminando expected_series de recepción previos:', e);
      }
      try {
        await supabase.from('checklists').delete().in('id', currentReceptionIds);
      } catch (e) {
        console.warn('Error eliminando checklists de recepción previos:', e);
      }
    }

    // 3. Recrear cada checklist del snapshot y reinsertar sus series
    let totalRestoredSeries = 0;
    for (const batch of restoredBatches) {
      try {
        const { data: newChecklist, error: batchErr } = await supabase
          .from('checklists')
          .insert({
            name: batch.name || 'Recepción Restaurada',
            folio: batch.folio || null,
            consecutive_number: batch.consecutiveNumber || null,
            status: batch.status || 'pending',
            created_at: batch.createdAt || new Date().toISOString()
          })
          .select('id')
          .single();

        if (batchErr || !newChecklist) {
          console.error('Error insertando checklist restaurado:', batchErr);
          continue;
        }

        const newBatchId = newChecklist.id;

        // Reinsertar expected_series asociadas
        const seriesList = batch.expectedSeries || [];
        if (seriesList.length > 0) {
          const CHUNK_SIZE = 80;
          for (let i = 0; i < seriesList.length; i += CHUNK_SIZE) {
            const chunk = seriesList.slice(i, i + CHUNK_SIZE).map(s => ({
              checklist_id: newBatchId,
              serial_number: (s.serial || s.serial_number || '').trim().toUpperCase(),
              material_model: s.material || s.material_model || 'MODELO GENERAL',
              internal_number: s.internalNumber || s.internal_number || null,
              warehouse_name: s.warehouseName || s.warehouse_name || 'Almacén 1',
              warehouse_row: s.warehouseRow || s.warehouse_row || 'Sin Asignar',
              warehouse_space: s.warehouseSpace || s.warehouse_space || null,
              system_status: s.systemStatus || s.system_status || 'Principal',
              printer_status: s.printerStatus || s.printer_status || 'DISPONIBLE',
              is_scanned: Boolean(s.isScanned || s.is_scanned),
              scanned_at: s.scannedAt || s.scanned_at || null,
              assigned_at: s.assignedAt || s.assigned_at || null
            }));
            await supabase.from('expected_series').insert(chunk);
            totalRestoredSeries += chunk.length;
          }
        }

        // Reinsertar unexpected_logs asociados
        const unexpList = batch.unexpectedLogs || [];
        if (unexpList.length > 0) {
          const unexpChunk = unexpList.map(u => ({
            checklist_id: newBatchId,
            scanned_value: u.scannedValue || u.scanned_value || String(u),
            created_at: u.createdAt || u.created_at || new Date().toISOString()
          }));
          await supabase.from('unexpected_logs').insert(unexpChunk);
        }
      } catch (err) {
        console.error('Error procesando lote de recepción en restauración:', err);
      }
    }

    // 4. Restaurar la caché local de checklists si venía en el snapshot
    if (checkpoint.data.checklistsCache) {
      const cache = InventoryRepository.getMetadataCache();
      cache.checklists = checkpoint.data.checklistsCache;
      InventoryRepository.saveMetadataCache(cache);
    }

    // 5. Notificar a través de sincronización en tiempo real
    try {
      RealtimeSyncService.notifyChange('restore_receptions_checkpoint');
    } catch {
      // Ignorar si no está conectado
    }

    return {
      success: true,
      restoredBatchesCount: restoredBatches.length,
      totalRestoredSeries,
      name: checkpoint.name
    };
  }
}
