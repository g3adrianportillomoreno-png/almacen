import { supabase } from '../utils/supabaseClient.js';
import { OfflineSyncService } from './OfflineSyncService.js';
import { MercadoLibreBatchModel, MercadoLibreItemModel } from '../models/MercadoLibreModel.js';

const STORAGE_KEY = 'cdm_mercadolibre_cache_v1';

/**
 * Repositorio de Mercado Libre (Patrón Repository)
 * Conexión bidireccional en la nube con Supabase:
 * 1. Usa las tablas dedicadas (mercadolibre_batches / mercadolibre_items / mercadolibre_unexpected) si existen.
 * 2. Si aún no se ha corrido el SQL de creación de tablas, guarda y sincroniza automáticamente en la nube
 *    usando las tablas existentes (checklists / expected_series / unexpected_logs) con prefijo [ML-...],
 *    garantizando que los archivos subidos en PC se vean en el celular en tiempo real sin configuración manual.
 */
export class MercadoLibreRepository {
  static getLocalCache() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Error leyendo caché local de Mercado Libre:", e);
      return [];
    }
  }

  static saveLocalCache(batches) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
      }
    } catch (e) {
      console.warn("Error guardando caché local de Mercado Libre:", e);
    }
  }

  static async fetchAllItems() {
    const PAGE_SIZE = 1000;
    let allItems = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('mercadolibre_items')
        .select('*')
        .order('id', { ascending: true })
        .range(from, to);

      if (error) {
        break;
      }

      if (data && data.length > 0) {
        allItems.push(...data);
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }

  /**
   * Respaldo en la nube usando la tabla existente `checklists` + `expected_series`
   * cuando las tablas mercadolibre_* aún no han sido creadas en Supabase.
   */
  static async fetchFromFallbackCloudTables() {
    const { data: clData, error: clErr } = await supabase
      .from('checklists')
      .select(`
        id, name, created_at, status, consecutive_number, folio,
        unexpected_logs (id, scanned_value, created_at)
      `)
      .ilike('name', '[ML-%')
      .order('created_at', { ascending: false });

    if (clErr) throw clErr;
    if (!clData || clData.length === 0) return [];

    const batchIds = clData.map(b => b.id);
    const { data: seriesData } = await supabase
      .from('expected_series')
      .select('*')
      .in('checklist_id', batchIds)
      .order('id', { ascending: true });

    const itemsByBatch = {};
    for (const s of (seriesData || [])) {
      if (!itemsByBatch[s.checklist_id]) itemsByBatch[s.checklist_id] = [];
      itemsByBatch[s.checklist_id].push(
        new MercadoLibreItemModel({
          id: s.id,
          batchId: s.checklist_id,
          guideNumber: s.serial_number || '',
          trackingNumber: s.material_model || '',
          isScanned: Boolean(s.is_scanned),
          scannedAt: s.scanned_at,
          scannedWith: s.warehouse_space || 'gun'
        })
      );
    }

    return clData.map(b => {
      const rawDate = b.created_at
        ? new Date(b.created_at).toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })
        : '';

      const unexpectedLogs = (b.unexpected_logs || []).map(un => ({
        id: un.id,
        scannedValue: un.scanned_value,
        createdAt: un.created_at
      }));

      return new MercadoLibreBatchModel({
        id: b.id,
        consecutive: b.consecutive_number || 1,
        folio: b.folio || MercadoLibreBatchModel.formatFolio(b.consecutive_number),
        name: b.name,
        cleanName: MercadoLibreBatchModel.extractCleanName(b.name),
        date: rawDate,
        status: b.status || 'pending',
        items: itemsByBatch[b.id] || [],
        unexpectedLogs
      });
    });
  }

  static useFallbackCloudTables = true;

  /**
   * Carga todos los lotes de Mercado Libre (sincronizados en la nube entre PC y Celular)
   */
  static async fetchAllBatches() {
    try {
      if (this.useFallbackCloudTables) {
        const cloudFallbackModels = await this.fetchFromFallbackCloudTables();
        this.saveLocalCache(cloudFallbackModels);
        return cloudFallbackModels;
      }

      const { data: batchesData, error: batchError } = await supabase
        .from('mercadolibre_batches')
        .select('*')
        .order('created_at', { ascending: false });

      if (batchError) {
        this.useFallbackCloudTables = true;
        // Si las tablas mercadolibre_* aún no existen en Supabase, usar las tablas existentes en la nube
        const cloudFallbackModels = await this.fetchFromFallbackCloudTables();
        this.saveLocalCache(cloudFallbackModels);
        return cloudFallbackModels;
      }

      const allItems = await this.fetchAllItems();

      const { data: unexpectedData } = await supabase
        .from('mercadolibre_unexpected')
        .select('*')
        .order('created_at', { ascending: false });

      const itemsByBatch = {};
      for (const it of allItems) {
        if (!itemsByBatch[it.batch_id]) itemsByBatch[it.batch_id] = [];
        itemsByBatch[it.batch_id].push(
          new MercadoLibreItemModel({
            id: it.id,
            batchId: it.batch_id,
            guideNumber: it.guide_number,
            trackingNumber: it.tracking_number,
            isScanned: it.is_scanned,
            scannedAt: it.scanned_at,
            scannedWith: it.scanned_with
          })
        );
      }

      const unexpectedByBatch = {};
      for (const un of (unexpectedData || [])) {
        if (!unexpectedByBatch[un.batch_id]) unexpectedByBatch[un.batch_id] = [];
        unexpectedByBatch[un.batch_id].push({
          id: un.id,
          scannedValue: un.scanned_value,
          createdAt: un.created_at
        });
      }

      const models = (batchesData || []).map(b => {
        const rawDate = b.created_at
          ? new Date(b.created_at).toLocaleDateString('es-MX', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })
          : '';

        return new MercadoLibreBatchModel({
          id: b.id,
          consecutive: b.consecutive_number || 1,
          folio: b.folio || MercadoLibreBatchModel.formatFolio(b.consecutive_number),
          name: b.name,
          cleanName: MercadoLibreBatchModel.extractCleanName(b.name),
          date: rawDate,
          status: b.status || 'pending',
          items: itemsByBatch[b.id] || [],
          unexpectedLogs: unexpectedByBatch[b.id] || []
        });
      });

      this.saveLocalCache(models);
      return models;
    } catch (err) {
      console.warn("Cargando respaldo local de Mercado Libre:", err.message);
      const cached = this.getLocalCache();
      return (cached || []).map(c => new MercadoLibreBatchModel(c));
    }
  }

  /**
   * Crea un nuevo lote con sus paquetes y lo guarda en la nube
   */
  static async createBatch(fileName, items = [], consecutiveNumber = 1) {
    const consecutive = parseInt(consecutiveNumber, 10) || 1;
    const folio = MercadoLibreBatchModel.formatFolio(consecutive);
    const fullName = `[${folio}] ${fileName}`;

    let newBatch = null;
    let savedItems = [];

    try {
      const { data, error } = await supabase
        .from('mercadolibre_batches')
        .insert({
          name: fullName,
          folio: folio,
          consecutive_number: consecutive,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;
      newBatch = data;

      const itemsToInsert = items.map(it => ({
        batch_id: newBatch.id,
        guide_number: it.guideNumber,
        tracking_number: it.trackingNumber,
        is_scanned: false
      }));

      const CHUNK_SIZE = 500;
      for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
        const chunk = itemsToInsert.slice(i, i + CHUNK_SIZE);
        const { data: insertedChunk, error: insertErr } = await supabase
          .from('mercadolibre_items')
          .insert(chunk)
          .select();
        if (insertErr) throw insertErr;
        if (insertedChunk) savedItems.push(...insertedChunk);
      }
    } catch {
      // Si las tablas mercadolibre_* no existen aún, guardar en la nube dentro de `checklists` y `expected_series`
      try {
        const { data: clBatch, error: clErr } = await supabase
          .from('checklists')
          .insert({
            name: fullName,
            folio: folio,
            consecutive_number: consecutive,
            status: 'pending'
          })
          .select()
          .single();

        if (clErr) throw clErr;
        newBatch = clBatch;

        const seriesToInsert = items.map(it => ({
          checklist_id: clBatch.id,
          serial_number: it.guideNumber,
          material_model: it.trackingNumber,
          warehouse_row: 'MERCADO_LIBRE',
          is_scanned: false
        }));

        const CHUNK_SIZE = 500;
        for (let i = 0; i < seriesToInsert.length; i += CHUNK_SIZE) {
          const chunk = seriesToInsert.slice(i, i + CHUNK_SIZE);
          const { data: insertedSeries, error: sErr } = await supabase
            .from('expected_series')
            .insert(chunk)
            .select();
          if (sErr) throw sErr;
          if (insertedSeries) {
            savedItems.push(
              ...insertedSeries.map(s => ({
                id: s.id,
                batch_id: s.checklist_id,
                guide_number: s.serial_number,
                tracking_number: s.material_model,
                is_scanned: false
              }))
            );
          }
        }
      } catch (fallbackErr) {
        console.warn("Guardando lote en LocalStorage como respaldo:", fallbackErr.message);
        const localId = `ml_local_${Date.now()}`;
        newBatch = {
          id: localId,
          name: fullName,
          folio: folio,
          consecutive_number: consecutive,
          status: 'pending',
          created_at: new Date().toISOString()
        };
      }
    }

    const rawDate = new Date().toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const createdModel = new MercadoLibreBatchModel({
      id: newBatch.id,
      consecutive: consecutive,
      folio: folio,
      name: fullName,
      cleanName: fileName,
      date: rawDate,
      status: 'pending',
      items:
        savedItems.length > 0
          ? savedItems.map(
              it =>
                new MercadoLibreItemModel({
                  id: it.id,
                  batchId: newBatch.id,
                  guideNumber: it.guide_number,
                  trackingNumber: it.tracking_number,
                  isScanned: false
                })
            )
          : items.map(
              (it, idx) =>
                new MercadoLibreItemModel({
                  id: `local_item_${idx}_${Date.now()}`,
                  batchId: newBatch.id,
                  guideNumber: it.guideNumber,
                  trackingNumber: it.trackingNumber,
                  isScanned: false
                })
            ),
      unexpectedLogs: []
    });

    const currentCached = this.getLocalCache();
    const updated = [createdModel, ...currentCached.filter(b => b.id !== createdModel.id)];
    this.saveLocalCache(updated);

    return createdModel;
  }

  /**
   * Registra el escaneo verificado de un paquete
   */
  static async registerScan(batchId, itemId, scannedWith = 'gun') {
    const scannedAt = new Date().toISOString();
    const idStr = String(itemId || '');

    if (!idStr.startsWith('local_item_')) {
      if (!OfflineSyncService.isOnline()) {
        OfflineSyncService.addToQueue('ML_REGISTER_SCAN', {
          batchId,
          itemId,
          scannedAt,
          scannedWith
        });
      } else {
        try {
          const { error } = await supabase
            .from('mercadolibre_items')
            .update({
              is_scanned: true,
              scanned_at: scannedAt,
              scanned_with: scannedWith
            })
            .eq('id', itemId);

          if (error) {
            // Respaldo en tabla expected_series
            const { error: fbErr } = await supabase
              .from('expected_series')
              .update({
                is_scanned: true,
                scanned_at: scannedAt,
                warehouse_space: scannedWith
              })
              .eq('id', itemId);

            if (fbErr) {
              OfflineSyncService.addToQueue('ML_REGISTER_SCAN', {
                batchId,
                itemId,
                scannedAt,
                scannedWith
              });
            }
          }
        } catch (err) {
          console.warn("Error actualizando escaneo en Supabase. Encolando offline:", err);
          OfflineSyncService.addToQueue('ML_REGISTER_SCAN', {
            batchId,
            itemId,
            scannedAt,
            scannedWith
          });
        }
      }
    }

    const currentCached = this.getLocalCache();
    const batch = currentCached.find(b => String(b.id) === String(batchId));
    if (batch && batch.items) {
      const it = batch.items.find(i => String(i.id) === String(itemId));
      if (it) {
        it.isScanned = true;
        it.scannedAt = scannedAt;
        it.scannedWith = scannedWith;
      }
      this.saveLocalCache(currentCached);
    }
  }

  /**
   * Registra una lectura no encontrada en la lista (incidencia)
   */
  static async logUnexpectedScan(batchId, scannedValue) {
    const trimmed = String(scannedValue || '').trim().toUpperCase();
    if (!trimmed) return;
    const bIdStr = String(batchId || '');

    if (!bIdStr.startsWith('ml_local_')) {
      if (!OfflineSyncService.isOnline()) {
        OfflineSyncService.addToQueue('ML_LOG_UNEXPECTED', { batchId, value: trimmed });
      } else {
        try {
          const { error } = await supabase
            .from('mercadolibre_unexpected')
            .insert({
              batch_id: batchId,
              scanned_value: trimmed
            });

          if (error) {
            const { error: fbErr } = await supabase
              .from('unexpected_logs')
              .insert({
                checklist_id: batchId,
                scanned_value: trimmed
              });
            if (fbErr) {
              OfflineSyncService.addToQueue('ML_LOG_UNEXPECTED', { batchId, value: trimmed });
            }
          }
        } catch (err) {
          OfflineSyncService.addToQueue('ML_LOG_UNEXPECTED', { batchId, value: trimmed });
        }
      }
    }

    const currentCached = this.getLocalCache();
    const batch = currentCached.find(b => String(b.id) === String(batchId));
    if (batch) {
      batch.unexpectedLogs = batch.unexpectedLogs || [];
      batch.unexpectedLogs.push({
        id: `unexp_${Date.now()}`,
        scannedValue: trimmed,
        createdAt: new Date().toISOString()
      });
      this.saveLocalCache(currentCached);
    }
  }

  /**
   * Marca el lote como 100% completado
   */
  static async markBatchCompleted(batchId) {
    const bIdStr = String(batchId || '');

    if (!bIdStr.startsWith('ml_local_')) {
      try {
        const { error } = await supabase
          .from('mercadolibre_batches')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', batchId);

        if (error) {
          await supabase
            .from('checklists')
            .update({ status: 'completed' })
            .eq('id', batchId);
        }
      } catch (err) {
        console.warn("Error completando lote en Supabase:", err);
      }
    }

    const currentCached = this.getLocalCache();
    const batch = currentCached.find(b => String(b.id) === String(batchId));
    if (batch) {
      batch.status = 'completed';
      this.saveLocalCache(currentCached);
    }
  }

  /**
   * Elimina un lote completo de Mercado Libre
   */
  static async deleteBatch(batchId) {
    const bIdStr = String(batchId || '');

    if (!bIdStr.startsWith('ml_local_')) {
      try {
        const { error } = await supabase.from('mercadolibre_batches').delete().eq('id', batchId);
        if (error) {
          await supabase.from('expected_series').delete().eq('checklist_id', batchId);
          await supabase.from('unexpected_logs').delete().eq('checklist_id', batchId);
          await supabase.from('checklists').delete().eq('id', batchId);
        }
      } catch (err) {
        console.warn("Error eliminando lote en Supabase:", err);
      }
    }

    const currentCached = this.getLocalCache();
    const updated = currentCached.filter(b => String(b.id) !== String(batchId));
    this.saveLocalCache(updated);
  }
}
