import { supabase } from '../utils/supabaseClient.js';
import { MercadoLibreBatchModel, MercadoLibreItemModel } from '../models/MercadoLibreModel.js';

const STORAGE_KEY = 'cdm_mercadolibre_cache_v1';

/**
 * Repositorio de Mercado Libre (Patrón Repository)
 * Conexión bidireccional con Supabase con paginación ilimitada y fallback a LocalStorage
 */
export class MercadoLibreRepository {
  /**
   * Obtiene la caché local de respaldo
   */
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

  /**
   * Guarda en la caché local
   */
  static saveLocalCache(batches) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
      }
    } catch (e) {
      console.warn("Error guardando caché local de Mercado Libre:", e);
    }
  }

  /**
   * Obtiene todos los paquetes asociados con paginación automática (supera límite de 1000)
   */
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
        console.warn('Nota Supabase mercadolibre_items:', error.message);
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
   * Carga todos los lotes de Mercado Libre
   */
  static async fetchAllBatches() {
    try {
      // 1. Consultar lotes en Supabase
      const { data: batchesData, error: batchError } = await supabase
        .from('mercadolibre_batches')
        .select('*')
        .order('created_at', { ascending: false });

      if (batchError) {
        throw batchError;
      }

      // 2. Consultar paquetes e incidencias
      const allItems = await this.fetchAllItems();

      const { data: unexpectedData } = await supabase
        .from('mercadolibre_unexpected')
        .select('*')
        .order('created_at', { ascending: false });

      // 3. Agrupar por batch_id
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

      // 4. Mapear modelos
      const models = (batchesData || []).map(b => {
        const rawDate = b.created_at ? new Date(b.created_at).toLocaleDateString('es-MX', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }) : '';

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

      // Guardar respaldo en caché local
      this.saveLocalCache(models);
      return models;
    } catch (err) {
      console.warn("Supabase no disponible o tablas aún no creadas, cargando respaldo local:", err.message);
      const cached = this.getLocalCache();
      return (cached || []).map(c => new MercadoLibreBatchModel(c));
    }
  }

  /**
   * Crea un nuevo lote con sus paquetes
   */
  static async createBatch(fileName, items = [], consecutiveNumber = 1) {
    const consecutive = parseInt(consecutiveNumber, 10) || 1;
    const folio = MercadoLibreBatchModel.formatFolio(consecutive);
    const fullName = `[${folio}] ${fileName}`;

    let newBatch = null;

    try {
      // Intentar insertar en Supabase
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

      // Insertar paquetes en chunks de 500
      const itemsToInsert = items.map(it => ({
        batch_id: newBatch.id,
        guide_number: it.guideNumber,
        tracking_number: it.trackingNumber,
        is_scanned: false
      }));

      const CHUNK_SIZE = 500;
      for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
        const chunk = itemsToInsert.slice(i, i + CHUNK_SIZE);
        const { error: insertErr } = await supabase.from('mercadolibre_items').insert(chunk);
        if (insertErr) throw insertErr;
      }
    } catch (err) {
      console.warn("Guardando lote en LocalStorage como respaldo (Supabase no disponible):", err.message);
      // Fallback a LocalStorage
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

    // Actualizar caché local
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
      items: items.map((it, idx) => new MercadoLibreItemModel({
        id: `local_item_${idx}_${Date.now()}`,
        batchId: newBatch.id,
        guideNumber: it.guideNumber,
        trackingNumber: it.trackingNumber,
        isScanned: false
      })),
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

    // Actualizar en Supabase si es un ID numérico
    if (typeof itemId === 'number' || (typeof itemId === 'string' && /^\d+$/.test(itemId))) {
      try {
        await supabase
          .from('mercadolibre_items')
          .update({
            is_scanned: true,
            scanned_at: scannedAt,
            scanned_with: scannedWith
          })
          .eq('id', itemId);
      } catch (err) {
        console.warn("Error actualizando escaneo en Supabase:", err);
      }
    }

    // Actualizar caché local
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

    if (typeof batchId === 'number' || (typeof batchId === 'string' && /^\d+$/.test(batchId))) {
      try {
        await supabase
          .from('mercadolibre_unexpected')
          .insert({
            batch_id: batchId,
            scanned_value: trimmed
          });
      } catch (err) {
        console.warn("Error guardando inesperado en Supabase:", err);
      }
    }

    // Actualizar caché local
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
    if (typeof batchId === 'number' || (typeof batchId === 'string' && /^\d+$/.test(batchId))) {
      try {
        await supabase
          .from('mercadolibre_batches')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', batchId);
      } catch (err) {
        console.warn("Error completando lote en Supabase:", err);
      }
    }

    // Actualizar caché local
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
    if (typeof batchId === 'number' || (typeof batchId === 'string' && /^\d+$/.test(batchId))) {
      try {
        // En cascada por la foreign key se eliminan items e unexpected
        await supabase.from('mercadolibre_batches').delete().eq('id', batchId);
      } catch (err) {
        console.warn("Error eliminando lote en Supabase:", err);
      }
    }

    // Eliminar de caché local
    const currentCached = this.getLocalCache();
    const updated = currentCached.filter(b => String(b.id) !== String(batchId));
    this.saveLocalCache(updated);
  }
}
