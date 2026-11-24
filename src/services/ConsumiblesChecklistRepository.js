// src/services/ConsumiblesChecklistRepository.js
import { supabase } from '../utils/supabaseClient.js';
import { ConsumiblesRepository } from './ConsumiblesRepository.js';
import { ConsumiblesController } from '../controllers/ConsumiblesController.js';
import { ChecklistModel } from '../models/ChecklistModel.js';
import * as XLSX from 'xlsx';

const STORAGE_KEY = 'cdm_consumables_checklists_v2';
const SUPABASE_CONFIG_ID = 'consumibles_checklists_history';

export class ConsumiblesChecklistRepository {
  /**
   * Obtiene la lista local de lotes de consumibles
   */
  static getLocalBatches() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Error leyendo lotes de consumibles en local:', e);
      return [];
    }
  }

  /**
   * Guarda la lista de lotes en local y en la nube
   */
  static saveLocalBatches(batches = []) {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
      }
      this.syncToSupabase(batches).catch(() => {});
    } catch (e) {
      console.warn('Error guardando lotes de consumibles:', e);
    }
  }

  /**
   * Respaldo en la nube en warehouse_map_config
   */
  static async syncToSupabase(batches = []) {
    try {
      await supabase
        .from('warehouse_map_config')
        .upsert({
          id: SUPABASE_CONFIG_ID,
          layout: { batches: batches.slice(0, 50) },
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn('Nota respaldo nube de lotes de consumibles:', e.message);
    }
  }

  /**
   * Carga todos los lotes de consumibles (combinando Supabase y LocalStorage)
   */
  static async fetchAllConsumablesBatches() {
    const local = this.getLocalBatches();
    try {
      const { data, error } = await supabase
        .from('warehouse_map_config')
        .select('layout')
        .eq('id', SUPABASE_CONFIG_ID)
        .maybeSingle();

      if (!error && data?.layout?.batches && Array.isArray(data.layout.batches)) {
        const cloudBatches = data.layout.batches;
        // Fusionar por ID preservando los más recientes
        const map = new Map();
        cloudBatches.forEach(b => map.set(String(b.id), b));
        local.forEach(b => {
          if (!map.has(String(b.id))) {
            map.set(String(b.id), b);
          } else {
            // Si el local tiene fecha de actualización más reciente, conservarlo
            const cloudB = map.get(String(b.id));
            if (new Date(b.updatedAt || 0) > new Date(cloudB.updatedAt || 0)) {
              map.set(String(b.id), b);
            }
          }
        });
        const merged = Array.from(map.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        this.saveLocalBatches(merged);
        return merged;
      }
    } catch (e) {
      console.warn('Nota consultando lotes de consumibles en Supabase:', e.message);
    }
    return local;
  }

  /**
   * Elimina un checklist de consumibles
   */
  static async deleteConsumiblesChecklist(batchId) {
    const list = this.getLocalBatches();
    const updated = list.filter(b => String(b.id) !== String(batchId));
    this.saveLocalBatches(updated);

    // Intentar también eliminar de la tabla checklists de Supabase si se registró allí
    try {
      await supabase.from('checklists').delete().eq('id', batchId);
    } catch {}

    return updated;
  }

  /**
   * Crea un nuevo Checklist de Consumibles
   */
  static async createConsumablesChecklist(fileName, parsedData, consecutiveNumber) {
    const rawVal = String(consecutiveNumber || '').trim();
    const consecutive = rawVal || '1';
    const numVal = parseInt(rawVal, 10);
    const folio = ChecklistModel.formatFolio(consecutive);
    const cleanFileName = fileName.replace(/\.[^/.]+$/, '');
    const fullName = `[${folio}] Lote Consumibles: ${cleanFileName}`;

    let supabaseId = `consumibles_batch_${Date.now()}`;

    // 1. Crear el registro en la tabla checklists de Supabase para tener folio oficial en el sistema
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

      if (res.data?.id) {
        supabaseId = String(res.data.id);
      }
    } catch (err) {
      console.warn('Nota creando registro base de checklist en Supabase:', err.message);
    }

    const nowIso = new Date().toISOString();

    const newBatch = {
      id: supabaseId,
      consecutive: numVal || 1,
      folio: folio,
      name: fullName,
      cleanName: cleanFileName,
      fileName: fileName,
      batchType: 'CONSUMIBLES',
      invoiceNumber: parsedData.invoiceNumber || '',
      supplierName: parsedData.supplierName || '',
      invoiceDate: parsedData.invoiceDate || '',
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'pending', // pending | in_progress | completed
      items: (parsedData.items || []).map(it => ({
        ...it,
        scannedQty: 0,
        pendingQty: it.expectedQty,
        status: 'PENDING',
        scansHistory: []
      })),
      totalItems: parsedData.totalItems || parsedData.items?.length || 0,
      totalExpectedUnits: parsedData.totalUnits || 0,
      totalScannedUnits: 0,
      totalPendingUnits: parsedData.totalUnits || 0,
      completedItemsCount: 0,
      stockCommittedAt: null
    };

    const currentBatches = this.getLocalBatches();
    const updatedBatches = [newBatch, ...currentBatches.filter(b => String(b.id) !== String(newBatch.id))];
    this.saveLocalBatches(updatedBatches);

    // Auto-vincular permanentemente códigos de barras al catálogo maestro
    (parsedData.items || []).forEach(it => {
      if (it.barcode && it.code && it.barcode !== it.code) {
        try {
          ConsumiblesRepository.linkBarcodeToConsumible(it.barcode, it.code);
        } catch (e) {}
      }
    });

    return newBatch;
  }

  /**
   * Obtiene un lote por su ID
   */
  static getBatchById(batchId) {
    const batches = this.getLocalBatches();
    return batches.find(b => String(b.id) === String(batchId)) || null;
  }

  /**
   * Registra un escaneo con la pistola lectora o entrada manual de código
   * Soporta multiplicador de cantidad (ej. 1, 10, 50 piezas)
   */
  static async recordScan(batchId, rawScannedCode, quantityToAdd = 1, operator = 'Operador') {
    const qtyToAdd = Math.max(1, parseInt(quantityToAdd, 10) || 1);
    const query = String(rawScannedCode || '').trim();
    if (!query) return { success: false, message: 'Código vacío' };

    const batches = this.getLocalBatches();
    const batchIndex = batches.findIndex(b => String(b.id) === String(batchId));
    if (batchIndex === -1) {
      return { success: false, message: 'Lote no encontrado' };
    }

    const batch = { ...batches[batchIndex] };
    const items = [...batch.items];

    // 1. Buscar coincidencia en los items del lote
    const queryClean = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const aliases = ConsumiblesController.getAliases();
    const mappedClave = (aliases[query] || aliases[queryClean] || '').toUpperCase();

    let matchedItemIndex = items.findIndex(it => {
      // Coincidencia exacta de barcode
      if (it.barcode && String(it.barcode).trim() === query) return true;
      const cleanB = String(it.barcode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanB && cleanB === queryClean) return true;

      // Coincidencia de clave
      const cleanCode = String(it.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanCode === queryClean) return true;

      // Coincidencia por alias mapeado
      if (mappedClave && cleanCode === mappedClave.replace(/[^A-Z0-9]/g, '')) return true;

      return false;
    });

    // 2. Si no encontró por barcode directo o clave exacta, buscar por subcadena de código
    if (matchedItemIndex === -1) {
      matchedItemIndex = items.findIndex(it => {
        const c = String(it.code || '').toUpperCase();
        return c.includes(query.toUpperCase()) || query.toUpperCase().includes(c);
      });
    }

    if (matchedItemIndex === -1) {
      return {
        success: false,
        notInBatch: true,
        message: `El código "${query}" no pertenece a este lote de consumibles (${batch.folio}).`,
        scannedCode: query
      };
    }

    // 3. Aplicar incremento de cantidad contada
    const item = { ...items[matchedItemIndex] };
    const previousScanned = item.scannedQty || 0;
    const newScanned = previousScanned + qtyToAdd;
    const expected = item.expectedQty || 0;
    const newPending = Math.max(0, expected - newScanned);

    let newStatus = 'IN_PROGRESS';
    if (newScanned === expected) newStatus = 'COMPLETED';
    else if (newScanned > expected) newStatus = 'SURPLUS';
    else if (newScanned === 0) newStatus = 'PENDING';

    const nowIso = new Date().toISOString();
    const scanEntry = {
      timestamp: nowIso,
      timeStr: new Date().toLocaleTimeString('es-MX', { hour12: true }),
      quantityAdded: qtyToAdd,
      scannedCode: query,
      operator: operator,
      newTotal: newScanned
    };

    item.scannedQty = newScanned;
    item.pendingQty = newPending;
    item.status = newStatus;
    item.lastScannedAt = nowIso;
    item.scansHistory = [scanEntry, ...(item.scansHistory || [])].slice(0, 50);

    items[matchedItemIndex] = item;

    // 3b. Auto-vincular permanentemente el código escaneado con la clave del producto
    if (query && item.code && query !== item.code) {
      try {
        await ConsumiblesRepository.linkBarcodeToConsumible(query, item.code);
      } catch (e) {}
    }
    if (item.barcode && item.code && item.barcode !== item.code) {
      try {
        await ConsumiblesRepository.linkBarcodeToConsumible(item.barcode, item.code);
      } catch (e) {}
    }

    // 3c. Sumar automáticamente las unidades recibidas al Maestro de Consumibles y registrar código de barras
    try {
      const barcodeFinal = (query && query !== item.code) ? query : (item.barcode || null);
      await ConsumiblesRepository.addStockToMaster(item.code, qtyToAdd, barcodeFinal);
    } catch (e) {
      console.warn("Nota sumando al inventario maestro de consumibles:", e);
    }

    // 4. Recalcular métricas del lote completo
    let totalScanned = 0;
    let totalPending = 0;
    let completedCount = 0;

    items.forEach(it => {
      totalScanned += (it.scannedQty || 0);
      totalPending += (it.pendingQty || 0);
      if (it.scannedQty >= it.expectedQty) completedCount++;
    });

    const isAllCompleted = items.length > 0 && items.every(it => it.scannedQty >= it.expectedQty);

    batch.items = items;
    batch.totalScannedUnits = totalScanned;
    batch.totalPendingUnits = totalPending;
    batch.completedItemsCount = completedCount;
    batch.status = isAllCompleted ? 'completed' : 'in_progress';
    batch.updatedAt = nowIso;

    batches[batchIndex] = batch;
    this.saveLocalBatches(batches);

    // Actualizar estado del checklist en Supabase si se completó
    if (isAllCompleted) {
      supabase.from('checklists').update({ status: 'completed' }).eq('id', batch.id).then(() => {}).catch(() => {});
    }

    return {
      success: true,
      item,
      quantityAdded: qtyToAdd,
      batch,
      isItemCompleted: item.scannedQty >= item.expectedQty,
      isSurplus: item.scannedQty > item.expectedQty
    };
  }

  /**
   * Ajuste manual directo de la cantidad contada de una partida
   */
  static async adjustItemQuantity(batchId, itemId, newTotalQuantity, operator = 'Operador') {
    const qty = Math.max(0, parseInt(newTotalQuantity, 10) || 0);
    const batches = this.getLocalBatches();
    const batchIndex = batches.findIndex(b => String(b.id) === String(batchId));
    if (batchIndex === -1) return null;

    const batch = { ...batches[batchIndex] };
    const items = [...batch.items];
    const itemIndex = items.findIndex(it => it.id === itemId || it.code === itemId);
    if (itemIndex === -1) return null;

    const item = { ...items[itemIndex] };
    const previous = item.scannedQty || 0;
    const diff = qty - previous;
    const expected = item.expectedQty || 0;

    item.scannedQty = qty;
    item.pendingQty = Math.max(0, expected - qty);
    if (qty === 0) item.status = 'PENDING';
    else if (qty === expected) item.status = 'COMPLETED';
    else if (qty > expected) item.status = 'SURPLUS';
    else item.status = 'IN_PROGRESS';

    const nowIso = new Date().toISOString();
    item.lastScannedAt = nowIso;
    item.scansHistory = [
      {
        timestamp: nowIso,
        timeStr: new Date().toLocaleTimeString('es-MX', { hour12: true }),
        quantityAdded: diff,
        manualAdjustment: true,
        operator,
        newTotal: qty
      },
      ...(item.scansHistory || [])
    ].slice(0, 50);

    items[itemIndex] = item;

    let totalScanned = 0;
    let totalPending = 0;
    let completedCount = 0;
    items.forEach(it => {
      totalScanned += (it.scannedQty || 0);
      totalPending += (it.pendingQty || 0);
      if (it.scannedQty >= it.expectedQty) completedCount++;
    });

    batch.items = items;
    batch.totalScannedUnits = totalScanned;
    batch.totalPendingUnits = totalPending;
    batch.completedItemsCount = completedCount;
    batch.status = items.every(it => it.scannedQty >= it.expectedQty) ? 'completed' : 'in_progress';
    batch.updatedAt = nowIso;

    batches[batchIndex] = batch;
    this.saveLocalBatches(batches);

    return batch;
  }

  /**
   * Suma las cantidades contadas físicamente directamente a las existencias maestras del almacén
   */
  static async commitStockToInventory(batchId) {
    const batches = this.getLocalBatches();
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch) throw new Error("Lote no encontrado");

    if (batch.stockCommittedAt) {
      throw new Error(`Las existencias de este lote ya fueron ingresadas al inventario el ${new Date(batch.stockCommittedAt).toLocaleString('es-MX')}`);
    }

    const itemsToIngress = batch.items.filter(it => (it.scannedQty || 0) > 0);
    if (itemsToIngress.length === 0) {
      throw new Error("No hay piezas contadas para ingresar al inventario.");
    }

    // Obtener catálogo maestro
    const catalog = await ConsumiblesRepository.getAllConsumibles();
    const catalogMap = new Map();
    catalog.forEach(item => {
      catalogMap.set(String(item.clave || '').trim().toUpperCase(), item);
    });

    let updatedCount = 0;
    let totalPiecesAdded = 0;

    itemsToIngress.forEach(it => {
      const codeKey = String(it.code || '').trim().toUpperCase();
      const existing = catalogMap.get(codeKey);
      if (existing) {
        const curStock = Number(existing.existencias) || 0;
        existing.existencias = curStock + it.scannedQty;
        // Si no tenía código de barras guardado, agregarlo
        if (it.barcode && (!existing.barcodes || !existing.barcodes.includes(it.barcode))) {
          existing.barcodes = [...(existing.barcodes || []), it.barcode];
        }
        updatedCount++;
        totalPiecesAdded += it.scannedQty;
      }
    });

    // Guardar catálogo maestro actualizado
    await ConsumiblesRepository.saveAllConsumibles(catalog);

    // Marcar lote con la fecha de compromiso
    batch.stockCommittedAt = new Date().toISOString();
    this.saveLocalBatches(batches);

    return {
      updatedCount,
      totalPiecesAdded,
      committedAt: batch.stockCommittedAt
    };
  }

  /**
   * Actualiza la ubicación física de una partida en el lote de recepción
   * Registra si fue verificada (VERIFIED_OK) o modificada de lugar (RELOCATED)
   */
  static async updateItemLocation(batchId, itemId, newLocation, isVerified = false, prevLocation = null, operator = 'Operador') {
    const batches = this.getLocalBatches();
    const batchIndex = batches.findIndex(b => String(b.id) === String(batchId));
    if (batchIndex === -1) return null;

    const batch = { ...batches[batchIndex] };
    const items = [...batch.items];
    const itIndex = items.findIndex(it => String(it.id) === String(itemId) || String(it.code) === String(itemId));
    if (itIndex === -1) return null;

    const it = { ...items[itIndex] };
    const prevLoc = prevLocation || it.location || 'Sin Asignar';
    it.location = newLocation;
    it.prevLocation = prevLoc;
    it.locationStatus = isVerified ? 'VERIFIED_OK' : 'RELOCATED';
    it.locationUpdatedAt = new Date().toISOString();

    // Registrar en el historial de movimientos de ubicación del lote
    const movement = {
      timestamp: it.locationUpdatedAt,
      timeStr: new Date().toLocaleString('es-MX', { hour12: true }),
      code: it.code,
      barcode: it.barcode || '',
      description: it.description || '',
      prevLocation: prevLoc,
      newLocation: newLocation,
      type: isVerified ? 'VERIFICACIÓN' : 'REUBICACIÓN',
      operator: operator || 'Operador',
      batchFolio: batch.folio || ''
    };

    batch.locationMovements = [movement, ...(batch.locationMovements || [])];

    // Registrar permanentemente en ConsumiblesRepository para el historial maestro
    try {
      ConsumiblesRepository.recordLocationMovement(movement);
    } catch (e) {}

    items[itIndex] = it;
    batch.items = items;
    batch.updatedAt = new Date().toISOString();

    batches[batchIndex] = batch;
    this.saveLocalBatches(batches);
    return { batch, item: it };
  }

  /**
   * Exporta a archivo Excel oficial el reporte completo de recepción de consumibles
   */
  static exportChecklistToExcel(batch) {
    if (!batch || !batch.items || batch.items.length === 0) {
      alert("No hay partidas para exportar.");
      return;
    }

    const downloadTimeStr = new Date().toLocaleString('es-MX', { hour12: true });
    const wb = XLSX.utils.book_new();

    // 1. HOJA RESUMEN
    const resumenRows = [
      { 'CAMPO': 'REPORTE DE RECEPCIÓN DE CONSUMIBLES (CHECKLIST)', 'VALOR': '' },
      { 'CAMPO': 'FOLIO DEL LOTE', 'VALOR': batch.folio },
      { 'CAMPO': 'FACTURA / INVOICE', 'VALOR': batch.invoiceNumber || 'Sin Factura' },
      { 'CAMPO': 'PROVEEDOR', 'VALOR': batch.supplierName || 'Zhejiang Besda / General' },
      { 'CAMPO': 'FECHA DE DOCUMENTO', 'VALOR': batch.invoiceDate || 'N/A' },
      { 'CAMPO': 'FECHA Y HORA DE DESCARGA', 'VALOR': downloadTimeStr },
      { 'CAMPO': '', 'VALOR': '' },
      { 'CAMPO': 'TOTAL DE PARTIDAS (SKUs)', 'VALOR': batch.totalItems || batch.items.length },
      { 'CAMPO': 'PARTIDAS COMPLETADAS AL 100%', 'VALOR': batch.completedItemsCount || 0 },
      { 'CAMPO': 'PARTIDAS CON FALTANTES', 'VALOR': batch.items.filter(it => (it.pendingQty || 0) > 0).length },
      { 'CAMPO': 'PARTIDAS CON EXCEDENTES', 'VALOR': batch.items.filter(it => (it.scannedQty || 0) > it.expectedQty).length },
      { 'CAMPO': 'UBICACIONES MODIFICADAS / REUBICADAS (AMARILLO)', 'VALOR': batch.items.filter(it => it.locationStatus === 'RELOCATED').length },
      { 'CAMPO': 'UBICACIONES VERIFICADAS CORRECTAS (VERDE)', 'VALOR': batch.items.filter(it => it.locationStatus === 'VERIFIED_OK').length },
      { 'CAMPO': '', 'VALOR': '' },
      { 'CAMPO': 'TOTAL PIEZAS ESPERADAS / FACTURADAS', 'VALOR': batch.totalExpectedUnits || 0 },
      { 'CAMPO': 'TOTAL PIEZAS FÍSICAMENTE RECIBIDAS', 'VALOR': batch.totalScannedUnits || 0 },
      { 'CAMPO': 'DIFERENCIA NETA (FALTANTES)', 'VALOR': batch.totalPendingUnits || 0 },
      { 'CAMPO': 'ESTADO DEL LOTE', 'VALOR': (batch.status === 'completed' ? 'COMPLETO' : 'INCOMPLETO / EN PROCESO') },
      { 'CAMPO': 'STOCK INGRESADO AL ALMACÉN', 'VALOR': batch.stockCommittedAt ? `SÍ (${new Date(batch.stockCommittedAt).toLocaleString('es-MX')})` : 'NO' }
    ];

    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 48 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // 2. HOJA DETALLE COMPLETO
    const detailRows = batch.items.map((it, idx) => {
      const exp = it.expectedQty || 0;
      const rcv = it.scannedQty || 0;
      const diff = rcv - exp;
      let estatusStr = 'PENDIENTE (0%)';
      if (rcv >= exp && exp > 0) {
        estatusStr = rcv > exp ? `EXCEDENTE (+${diff})` : 'COMPLETO (100%)';
      } else if (rcv > 0) {
        estatusStr = `EN PROCESO (${Math.round((rcv / exp) * 100)}%)`;
      }

      let auditStatus = 'SIN AUDITAR';
      if (it.locationStatus === 'RELOCATED') {
        auditStatus = '⚠️ CAMBIO DE LUGAR (MODIFICADA)';
      } else if (it.locationStatus === 'VERIFIED_OK') {
        auditStatus = '✓ TODO BIEN (VERIFICADA)';
      }

      return {
        'NO.': idx + 1,
        'CLAVE / CÓDIGO': it.code || '',
        'CÓDIGO DE BARRAS (BARCODE)': it.barcode || '',
        'DESCRIPCIÓN': it.description || '',
        'COMPATIBILIDAD (MODELOS)': it.forUseIn || '',
        'UBICACIÓN FÍSICA ALMACÉN': it.location || 'Sin Asignar',
        'AUDITORÍA DE UBICACIÓN': auditStatus,
        'UBICACIÓN ANTERIOR (SI CAMBIÓ)': it.locationStatus === 'RELOCATED' ? (it.prevLocation || '') : '',
        'CANTIDAD ESPERADA': exp,
        'CANTIDAD RECIBIDA': rcv,
        'FALTANTES': it.pendingQty || 0,
        'DIFERENCIA': diff,
        'ESTATUS': estatusStr,
        'PRECIO UNITARIO ($)': it.unitPrice || 0,
        'TOTAL FACTURADO ($)': Math.round((exp * (it.unitPrice || 0)) * 100) / 100,
        'ÚLTIMA LECTURA': it.lastScannedAt ? new Date(it.lastScannedAt).toLocaleString('es-MX', { hour12: true }) : '-'
      };
    });

    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 22 },
      { wch: 40 },
      { wch: 35 },
      { wch: 28 },
      { wch: 32 },
      { wch: 28 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, "DETALLE_RECEPCION");

    // 3. HOJA FALTANTES PROVEEDOR (Para reclamar faltantes)
    const faltantesItems = batch.items.filter(it => (it.pendingQty || 0) > 0);
    const faltantesRows = faltantesItems.map((it, idx) => ({
      'NO.': idx + 1,
      'CLAVE / CÓDIGO': it.code || '',
      'CÓDIGO DE BARRAS': it.barcode || '',
      'DESCRIPCIÓN': it.description || '',
      'CANTIDAD FACTURADA': it.expectedQty || 0,
      'CANTIDAD RECIBIDA': it.scannedQty || 0,
      'PIEZAS FALTANTES': it.pendingQty || 0,
      'PRECIO UNITARIO': it.unitPrice || 0,
      'IMPORTE FALTANTE ($)': Math.round(((it.pendingQty || 0) * (it.unitPrice || 0)) * 100) / 100
    }));

    const wsFaltantes = XLSX.utils.json_to_sheet(
      faltantesRows.length > 0 ? faltantesRows : [{
        'NO.': '',
        'CLAVE / CÓDIGO': 'SIN FALTANTES',
        'CÓDIGO DE BARRAS': '',
        'DESCRIPCIÓN': 'Todos los consumibles se recibieron al 100%.',
        'CANTIDAD FACTURADA': '',
        'CANTIDAD RECIBIDA': '',
        'PIEZAS FALTANTES': 0,
        'PRECIO UNITARIO': '',
        'IMPORTE FALTANTE ($)': 0
      }]
    );
    wsFaltantes['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 20 },
      { wch: 40 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(wb, wsFaltantes, "FALTANTES_PROVEEDOR");

    // 4. HOJA MOVIMIENTOS DE UBICACIONES (PASADO Y NUEVA UBICACIÓN)
    const movementsList = [];
    if (Array.isArray(batch.locationMovements) && batch.locationMovements.length > 0) {
      batch.locationMovements.forEach((m, idx) => {
        movementsList.push({
          'NO.': idx + 1,
          'FECHA Y HORA': m.timeStr || (m.timestamp ? new Date(m.timestamp).toLocaleString('es-MX', { hour12: true }) : '-'),
          'CLAVE / CÓDIGO': m.code || '',
          'CÓDIGO DE BARRAS': m.barcode || '',
          'DESCRIPCIÓN': m.description || '',
          'UBICACIÓN ANTERIOR (PASADA)': m.prevLocation || 'Sin Asignar',
          'UBICACIÓN NUEVA (ACTUAL)': m.newLocation || 'Sin Asignar',
          'TIPO DE MOVIMIENTO': m.type || 'REUBICACIÓN',
          'OPERADOR RESPONSABLE': m.operator || 'Operador',
          'FOLIO DE RECEPCIÓN': m.batchFolio || batch.folio || ''
        });
      });
    }

    // Agregar también partidas que hayan sido reubicadas o verificadas si no estaban en el array
    batch.items.forEach(it => {
      if (it.locationStatus === 'RELOCATED' && it.prevLocation && it.prevLocation !== it.location) {
        const alreadyIn = movementsList.some(m => m['CLAVE / CÓDIGO'] === it.code && m['UBICACIÓN NUEVA (ACTUAL)'] === it.location);
        if (!alreadyIn) {
          movementsList.push({
            'NO.': movementsList.length + 1,
            'FECHA Y HORA': it.locationUpdatedAt ? new Date(it.locationUpdatedAt).toLocaleString('es-MX', { hour12: true }) : downloadTimeStr,
            'CLAVE / CÓDIGO': it.code || '',
            'CÓDIGO DE BARRAS': it.barcode || '',
            'DESCRIPCIÓN': it.description || '',
            'UBICACIÓN ANTERIOR (PASADA)': it.prevLocation,
            'UBICACIÓN NUEVA (ACTUAL)': it.location,
            'TIPO DE MOVIMIENTO': 'REUBICACIÓN',
            'OPERADOR RESPONSABLE': 'Operador',
            'FOLIO DE RECEPCIÓN': batch.folio || ''
          });
        }
      }
    });

    const wsMovimientos = XLSX.utils.json_to_sheet(
      movementsList.length > 0 ? movementsList : [{
        'NO.': '',
        'FECHA Y HORA': '',
        'CLAVE / CÓDIGO': 'SIN CAMBIOS',
        'CÓDIGO DE BARRAS': '',
        'DESCRIPCIÓN': 'No se realizaron modificaciones de ubicación en este lote.',
        'UBICACIÓN ANTERIOR (PASADA)': '',
        'UBICACIÓN NUEVA (ACTUAL)': '',
        'TIPO DE MOVIMIENTO': '',
        'OPERADOR RESPONSABLE': '',
        'FOLIO DE RECEPCIÓN': batch.folio || ''
      }]
    );
    wsMovimientos['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 20 },
      { wch: 20 },
      { wch: 40 },
      { wch: 28 },
      { wch: 28 },
      { wch: 22 },
      { wch: 22 },
      { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, wsMovimientos, "MOVIMIENTOS_UBICACIONES");

    const dateStr = new Date().toISOString().slice(0, 10);
    const cleanFolio = (batch.folio || 'LOTE').replace(/[^a-zA-Z0-9_-]/g, '_');
    XLSX.writeFile(wb, `Checklist_Consumibles_${cleanFolio}_${dateStr}.xlsx`);
  }
}
