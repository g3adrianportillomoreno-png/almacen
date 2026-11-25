// src/services/ConsumiblesRepository.js
import defaultConsumibles from '../utils/consumiblesDefaultData.json';
import { supabase } from '../utils/supabaseClient.js';
import * as XLSX from 'xlsx';

const STORAGE_KEY = 'cdm_consumibles_catalog_v2';
const ALIASES_STORAGE_KEY = 'cdm_consumibles_barcode_aliases_v2';
const SUPABASE_CONFIG_KEY = 'consumibles_catalog_v2';
const SUPABASE_ALIASES_KEY = 'consumibles_barcode_aliases_v2';

export class ConsumiblesRepository {
  /**
   * Obtiene el diccionario de alias de códigos de barras { [barcode]: clave }
   */
  static getBarcodeAliases() {
    try {
      const raw = localStorage.getItem(ALIASES_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Error leyendo barcode aliases:', e);
    }
    // Inicial por defecto (ej. IK03847 vinculado a 6920952323115)
    const initial = {
      '6920952323115': 'IK03847'
    };
    try {
      localStorage.setItem(ALIASES_STORAGE_KEY, JSON.stringify(initial));
    } catch (e) {}
    return initial;
  }

  static async saveBarcodeAliases(aliases) {
    try {
      localStorage.setItem(ALIASES_STORAGE_KEY, JSON.stringify(aliases));
      await supabase
        .from('warehouse_map_config')
        .upsert({
          id: SUPABASE_ALIASES_KEY,
          config: aliases,
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn('Error guardando barcode aliases:', e);
    }
  }

  /**
   * Obtiene todos los consumibles (de localStorage, Supabase o precarga inicial)
   */
  static async getAllConsumibles() {
    // 1. Intentar de localStorage para respuesta instantánea
    try {
      const localRaw = localStorage.getItem(STORAGE_KEY);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.syncFromSupabaseInBackground();
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error leyendo consumibles de localStorage:', e);
    }

    // 2. Si no hay en local, intentar de Supabase
    try {
      const { data, error } = await supabase
        .from('warehouse_map_config')
        .select('config')
        .eq('id', SUPABASE_CONFIG_KEY)
        .maybeSingle();

      if (!error && data?.config && Array.isArray(data.config) && data.config.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.config));
        return data.config;
      }
    } catch (e) {
      console.warn('Error cargando consumibles de Supabase:', e);
    }

    // 3. Fallback inicial con el catálogo por defecto
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultConsumibles));
      this.syncToSupabase(defaultConsumibles).catch(() => {});
      return defaultConsumibles;
    } catch (e) {
      console.warn('Error guardando consumibles por defecto:', e);
      return defaultConsumibles || [];
    }
  }

  /**
   * Sincronización en segundo plano desde Supabase si existe una versión más reciente
   */
  static async syncFromSupabaseInBackground() {
    try {
      const { data, error } = await supabase
        .from('warehouse_map_config')
        .select('config, updated_at')
        .eq('id', SUPABASE_CONFIG_KEY)
        .maybeSingle();

      if (!error && data?.config && Array.isArray(data.config) && data.config.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.config));
      }

      // Sincronizar también los aliases
      const { data: aliasData } = await supabase
        .from('warehouse_map_config')
        .select('config')
        .eq('id', SUPABASE_ALIASES_KEY)
        .maybeSingle();

      if (aliasData?.config) {
        const localAliases = this.getBarcodeAliases();
        const merged = { ...localAliases, ...aliasData.config };
        localStorage.setItem(ALIASES_STORAGE_KEY, JSON.stringify(merged));
      }
    } catch (e) {
      // Silencioso
    }
  }

  /**
   * Guarda todo el catálogo de consumibles en localStorage y Supabase
   */
  static async saveAllConsumibles(items) {
    if (!Array.isArray(items)) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('Error guardando en localStorage:', e);
    }

    await this.syncToSupabase(items);
  }

  static async syncToSupabase(items) {
    try {
      await supabase
        .from('warehouse_map_config')
        .upsert({
          id: SUPABASE_CONFIG_KEY,
          config: items,
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn('Error sincronizando consumibles a Supabase:', e);
    }
  }

  /**
   * Vincula permanentemente un código de barras (ej. EAN 6920952323115) a un consumible
   */
  static async linkBarcodeToConsumible(rawBarcode, claveOrId) {
    if (!rawBarcode || !claveOrId) return null;
    const barcode = String(rawBarcode).trim();
    const cleanBarcode = barcode.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const catalog = await this.getAllConsumibles();
    let targetItem = null;

    const updatedCatalog = catalog.map(item => {
      const isMatch = (
        String(item.id) === String(claveOrId) ||
        String(item.clave).trim().toUpperCase() === String(claveOrId).trim().toUpperCase()
      );

      if (isMatch) {
        const existingBarcodes = Array.isArray(item.barcodes) ? [...item.barcodes] : [];
        if (!existingBarcodes.includes(barcode)) {
          existingBarcodes.push(barcode);
        }
        if (cleanBarcode && !existingBarcodes.includes(cleanBarcode)) {
          existingBarcodes.push(cleanBarcode);
        }
        targetItem = {
          ...item,
          barcodes: existingBarcodes,
          updatedAt: new Date().toISOString()
        };
        return targetItem;
      }
      return item;
    });

    if (!targetItem) {
      console.warn(`No se encontró consumible con clave o id ${claveOrId}`);
      return null;
    }

    // Guardar catálogo actualizado
    await this.saveAllConsumibles(updatedCatalog);

    // Guardar en mapa rápido de aliases
    const aliases = this.getBarcodeAliases();
    aliases[cleanBarcode] = targetItem.clave;
    aliases[barcode] = targetItem.clave;
    await this.saveBarcodeAliases(aliases);

    return targetItem;
  }

  /**
   * Suma piezas recibidas de un checklist directamente al inventario maestro de consumibles
   * y guarda el código de barras en el registro del producto
   */
  static async addStockToMaster(claveOrCode, quantityToAdd = 0, barcode = null) {
    if (!claveOrCode || quantityToAdd <= 0) return null;
    const qty = parseInt(quantityToAdd, 10);
    if (isNaN(qty) || qty <= 0) return null;

    const queryKey = String(claveOrCode).trim().toUpperCase();
    const catalog = await this.getAllConsumibles();
    const aliases = this.getBarcodeAliases();
    const mappedClave = (aliases[queryKey] || '').toUpperCase();

    let targetItem = null;
    const updated = catalog.map(item => {
      const itClave = String(item.clave || '').trim().toUpperCase();
      const itId = String(item.id);
      const isMatch = itClave === queryKey || itId === queryKey || (mappedClave && itClave === mappedClave);

      if (isMatch) {
        const curStock = Number(item.existencias) || 0;
        const newStock = curStock + qty;
        const existingBarcodes = Array.isArray(item.barcodes) ? [...item.barcodes] : [];

        if (barcode && String(barcode).trim()) {
          const rawB = String(barcode).trim();
          const cleanB = rawB.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!existingBarcodes.includes(rawB)) existingBarcodes.push(rawB);
          if (cleanB && !existingBarcodes.includes(cleanB)) existingBarcodes.push(cleanB);
          // Actualizar alias
          aliases[rawB] = item.clave;
          if (cleanB) aliases[cleanB] = item.clave;
        }

        targetItem = {
          ...item,
          existencias: newStock,
          barcodes: existingBarcodes,
          updatedAt: new Date().toISOString()
        };
        return targetItem;
      }
      return item;
    });

    if (targetItem) {
      await this.saveAllConsumibles(updated);
      await this.saveBarcodeAliases(aliases);
    }

    return targetItem;
  }

  /**
   * Guarda un movimiento de ubicación física en el historial permanente
   */
  static recordLocationMovement(movement) {
    if (!movement) return;
    try {
      const STORAGE_MOVEMENTS_KEY = 'cdm_consumables_location_movements_v1';
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_MOVEMENTS_KEY) : null;
      const list = raw ? JSON.parse(raw) : [];
      const entry = {
        id: `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: movement.timestamp || new Date().toISOString(),
        dateFormatted: movement.dateFormatted || new Date().toLocaleString('es-MX', { hour12: true }),
        clave: movement.clave || movement.code || '',
        description: movement.description || '',
        barcode: movement.barcode || '',
        prevLocation: movement.prevLocation || 'Sin Asignar',
        newLocation: movement.newLocation || 'Sin Asignar',
        movementType: movement.movementType || 'REUBICACIÓN',
        operator: movement.operator || 'Operador',
        batchFolio: movement.batchFolio || ''
      };

      const updated = [entry, ...(Array.isArray(list) ? list : [])].slice(0, 500);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_MOVEMENTS_KEY, JSON.stringify(updated));
      }

      // Respaldo asíncrono en Supabase
      supabase
        .from('warehouse_map_config')
        .upsert({
          id: 'consumables_location_movements',
          layout: { movements: updated.slice(0, 300) },
          updated_at: new Date().toISOString()
        })
        .then(() => {})
        .catch(() => {});

      return entry;
    } catch (e) {
      console.warn('Nota guardando movimiento de ubicación:', e);
    }
  }

  /**
   * Obtiene todos los movimientos de ubicación registrados
   */
  static getLocationMovements() {
    try {
      const STORAGE_MOVEMENTS_KEY = 'cdm_consumables_location_movements_v1';
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_MOVEMENTS_KEY) : null;
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Modifica la ubicación de un consumible desde el modo operador
   * Registra si hubo cambio de ubicación (wasChanged), la ubicación anterior y el operador
   */
  static async updateConsumibleLocation(idOrClave, newLocation, operator = 'Operador') {
    const list = await this.getAllConsumibles();
    let updatedItem = null;
    let wasChanged = false;
    let capturedPrevLoc = null;
    let capturedNewLoc = null;

    const updated = list.map(item => {
      const isMatch = String(item.id) === String(idOrClave) || 
        String(item.clave).trim().toUpperCase() === String(idOrClave).trim().toUpperCase();
      if (!isMatch) return item;

      const prevLoc = {
        almacen: item.almacen || 'Principal',
        seccion: item.seccion || '',
        anaquel: item.anaquel || '',
        espacio: item.espacio || ''
      };

      const newLoc = {
        almacen: (newLocation.almacen !== undefined ? newLocation.almacen : item.almacen) || 'Principal',
        seccion: (newLocation.seccion !== undefined ? newLocation.seccion : item.seccion) || '',
        anaquel: (newLocation.anaquel !== undefined ? newLocation.anaquel : item.anaquel) || '',
        espacio: (newLocation.espacio !== undefined ? newLocation.espacio : item.espacio) || ''
      };

      capturedPrevLoc = prevLoc;
      capturedNewLoc = newLoc;

      // Verificar si realmente cambió de posición física
      wasChanged = (
        String(prevLoc.almacen).trim().toUpperCase() !== String(newLoc.almacen).trim().toUpperCase() ||
        String(prevLoc.seccion).trim().toUpperCase() !== String(newLoc.seccion).trim().toUpperCase() ||
        String(prevLoc.anaquel).trim().toUpperCase() !== String(newLoc.anaquel).trim().toUpperCase() ||
        String(prevLoc.espacio).trim().toUpperCase() !== String(newLoc.espacio).trim().toUpperCase()
      );

      updatedItem = {
        ...item,
        ...newLoc,
        locationStatus: wasChanged ? 'RELOCATED' : 'VERIFIED_OK',
        previousLocation: wasChanged ? prevLoc : (item.previousLocation || null),
        lastVerifiedAt: new Date().toISOString(),
        verifiedBy: operator,
        updatedAt: new Date().toISOString()
      };
      return updatedItem;
    });

    if (updatedItem) {
      await this.saveAllConsumibles(updated);

      // Registrar permanentemente en el historial de movimientos de ubicación
      const pStr = capturedPrevLoc ? `${capturedPrevLoc.seccion || ''} [${capturedPrevLoc.anaquel || ''} - ${capturedPrevLoc.espacio || ''}]`.trim() : 'Sin Asignar';
      const nStr = capturedNewLoc ? `${capturedNewLoc.seccion || ''} [${capturedNewLoc.anaquel || ''} - ${capturedNewLoc.espacio || ''}]`.trim() : 'Sin Asignar';

      this.recordLocationMovement({
        timestamp: updatedItem.lastVerifiedAt,
        dateFormatted: new Date().toLocaleString('es-MX', { hour12: true }),
        clave: updatedItem.clave,
        description: updatedItem.nombre || updatedItem.descripcion || '',
        barcode: Array.isArray(updatedItem.barcodes) ? updatedItem.barcodes.join(', ') : '',
        prevLocation: pStr,
        newLocation: nStr,
        movementType: wasChanged ? 'REUBICACIÓN' : 'VERIFICACIÓN',
        operator: operator || 'Operador',
        batchFolio: 'CATÁLOGO MAESTRO'
      });
    }
    return { item: updatedItem, wasChanged };
  }

  /**
   * Exporta a Excel el reporte de revisión / auditoría de ubicaciones del operador
   * Destaca cuáles consumibles fueron modificados de lugar (amarillo / MODIFICADO)
   * y cuáles estuvieron correctos (verde / CORRECTO)
   */
  static exportOperatorAuditExcel(sessionHistory = []) {
    if (!sessionHistory || sessionHistory.length === 0) {
      alert("No hay consumibles revisados en la sesión actual.");
      return;
    }

    const wb = XLSX.utils.book_new();

    const rows = sessionHistory.map((entry, idx) => {
      const it = entry.item;
      const wasMod = entry.status === 'RELOCATED' || it.locationStatus === 'RELOCATED' || entry.wasChanged;
      const statusLabel = wasMod ? 'MODIFICADA / CAMBIO DE LUGAR' : 'CORRECTA (SIN CAMBIOS)';
      const prevLocStr = it.previousLocation 
        ? `${it.previousLocation.seccion || ''} [${it.previousLocation.anaquel || ''} - ${it.previousLocation.espacio || ''}]`.trim() 
        : (entry.prevLocationStr || '-');

      return {
        'NO.': idx + 1,
        'CLAVE': it.clave || '',
        'NOMBRE': it.nombre || '',
        'ESTADO DE UBICACIÓN': statusLabel,
        'SECCIÓN ACTUAL': it.seccion || '',
        'ANAQUEL ACTUAL': it.anaquel || '',
        'ESPACIO ACTUAL': it.espacio || '',
        'ALMACÉN': it.almacen || 'Principal',
        'UBICACIÓN ANTERIOR': prevLocStr,
        'EXISTENCIAS': it.existencias ?? 0,
        'HORA DE REVISIÓN': entry.timestamp || new Date().toLocaleTimeString('es-MX', { hour12: true }),
        'OPERADOR': entry.operator || it.verifiedBy || 'Operador'
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 38 },
      { wch: 32 }, // ESTADO DE UBICACIÓN
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 25 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "REVISIÓN_UBICACIONES");
    const fileName = `Revision_Ubicaciones_Operador_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  /**
   * Actualiza un consumible específico
   */
  static async updateConsumible(id, patch) {
    const list = await this.getAllConsumibles();
    const updated = list.map(item => {
      if (String(item.id) === String(id) || String(item.clave).trim().toUpperCase() === String(id).trim().toUpperCase()) {
        return { ...item, ...patch, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    await this.saveAllConsumibles(updated);
    return updated;
  }

  /**
   * Importa consumibles desde un archivo Excel o CSV (File o ArrayBuffer)
   */
  static async importFromExcel(fileOrBuffer) {
    let workbook;
    if (fileOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(fileOrBuffer)) {
      workbook = XLSX.read(fileOrBuffer, { type: 'array' });
    } else if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
      const buffer = await fileOrBuffer.arrayBuffer();
      workbook = XLSX.read(buffer, { type: 'array' });
    } else {
      throw new Error('Formato de archivo no soportado.');
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet);

    if (!rawRows || rawRows.length === 0) {
      throw new Error('El archivo no contiene filas de datos.');
    }

    const aliases = this.getBarcodeAliases();
    const cleanItems = [];

    rawRows.forEach((r, idx) => {
      const rawClave = r['Clave'] || r['CLAVE'] || r['clave'] || r['Codigo'] || r['Código'] || r['Serie'] || '';
      if (!rawClave || String(rawClave).trim().toUpperCase() === 'TOTAL') {
        return;
      }

      const clave = String(rawClave).trim();
      const nombre = String(r['Nombre'] || r['NOMBRE'] || r['Descripción'] || r['Descripcion'] || '').trim();
      const categoria = String(r['Categoría'] || r['Categoria'] || r['CATEGORÍA'] || 'General').trim();
      const existencias = Number(r['Existencias'] || r['EXISTENCIAS'] || r['Stock'] || r['Cantidad']) || 0;
      const zona = String(r['Zona'] || r['ZONA'] || '').trim();
      const seccion = String(r['Sección'] || r['Seccion'] || r['SECCIÓN'] || r['Fila'] || '').trim();
      const anaquel = String(r['Anaquel'] || r['ANAQUEL'] || '').trim();
      const espacio = String(r['Espacio'] || r['ESPACIO'] || '').trim();
      const almacen = String(r['Almacén'] || r['Almacen'] || r['ALMACÉN'] || 'Principal').trim();
      const stock_min = Number(r['Stock Min.'] || r['Stock Min'] || r['Stock_Min'] || r['Minimo']) || 0;
      const stock_max = Number(r['Stock Max.'] || r['Stock Max'] || r['Stock_Max'] || r['Maximo']) || 0;

      // Extraer posibles códigos de barras del Excel
      const rawBarcode = r['Código de barras'] || r['Codigo de barras'] || r['Código de Barras'] || r['EAN'] || r['UPC'] || r['Número de serie'] || '';
      const barcodes = [];
      if (rawBarcode && String(rawBarcode).trim()) {
        const b = String(rawBarcode).trim();
        barcodes.push(b);
        aliases[b] = clave;
      }

      // Si ya existía un alias previo para esta clave
      Object.entries(aliases).forEach(([bCode, cClave]) => {
        if (cClave === clave && !barcodes.includes(bCode)) {
          barcodes.push(bCode);
        }
      });

      cleanItems.push({
        id: idx + 1,
        clave,
        nombre,
        categoria,
        existencias,
        zona,
        seccion,
        anaquel,
        espacio,
        almacen,
        stock_min,
        stock_max,
        barcodes,
        updatedAt: new Date().toISOString()
      });
    });

    if (cleanItems.length === 0) {
      throw new Error('No se encontraron registros válidos con la columna "Clave" en el archivo.');
    }

    await this.saveAllConsumibles(cleanItems);
    await this.saveBarcodeAliases(aliases);
    return cleanItems;
  }

  /**
   * Exporta el catálogo actual a un archivo Excel (.xlsx)
   */
  /**
   * Exporta el catálogo actual a un archivo Excel (.xlsx) con marcas de auditoría
   * y pestaña dedicada de MOVIMIENTOS_UBICACIONES (pasado y nueva ubicación)
   */
  static exportToExcel(items = []) {
    if (!items || items.length === 0) {
      alert('No hay consumibles para exportar.');
      return;
    }

    const downloadTimeStr = new Date().toLocaleString('es-MX', { hour12: true });
    const wb = XLSX.utils.book_new();

    // 1. HOJA PRINCIPAL: CONSUMIBLES_CATALOGO (con columnas de auditoría y marcas de color/estado)
    const rows = items.map((it, idx) => {
      let auditStatus = 'SIN AUDITAR';
      if (it.locationStatus === 'RELOCATED') {
        auditStatus = '⚠️ CAMBIO DE LUGAR (MODIFICADA - AMARILLO)';
      } else if (it.locationStatus === 'VERIFIED_OK') {
        auditStatus = '✓ TODO BIEN (VERIFICADA - VERDE)';
      }

      const prevLocStr = it.previousLocation 
        ? (typeof it.previousLocation === 'object' 
            ? `${it.previousLocation.seccion || ''} [${it.previousLocation.anaquel || ''} - ${it.previousLocation.espacio || ''}]`.trim() 
            : String(it.previousLocation))
        : (it.locationStatus === 'RELOCATED' ? 'Reubicada' : '-');

      const curLocStr = `${it.seccion || ''} [${it.anaquel || ''} - ${it.espacio || ''}]`.trim() || it.location || 'Sin Asignar';

      return {
        'No.': idx + 1,
        'Clave': it.clave || '',
        'Nombre': it.nombre || '',
        'ESTADO DE AUDITORÍA': auditStatus,
        'UBICACIÓN ANTERIOR (PASADA)': prevLocStr,
        'UBICACIÓN ACTUAL (NUEVA)': curLocStr,
        'Almacén': it.almacen || 'Principal',
        'Sección': it.seccion || '',
        'Anaquel': it.anaquel || '',
        'Espacio': it.espacio || '',
        'Existencias': it.existencias ?? 0,
        'FECHA DE AUDITORÍA / CAMBIO': it.lastVerifiedAt ? new Date(it.lastVerifiedAt).toLocaleString('es-MX', { hour12: true }) : '-',
        'OPERADOR RESPONSABLE': it.verifiedBy || 'Operador',
        'Códigos de Barras Vinculados': Array.isArray(it.barcodes) ? it.barcodes.join(', ') : (it.barcode || ''),
        'Categoría': it.categoria || '',
        'Zona': it.zona || '',
        'Stock Min.': it.stock_min ?? 0,
        'Stock Max.': it.stock_max ?? 0
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 45 },
      { wch: 42 }, // ESTADO DE AUDITORÍA
      { wch: 30 }, // UBICACIÓN ANTERIOR (PASADA)
      { wch: 30 }, // UBICACIÓN ACTUAL (NUEVA)
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 24 }, // FECHA DE AUDITORÍA
      { wch: 20 }, // OPERADOR
      { wch: 30 },
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'CONSUMIBLES_CATALOGO');

    // 2. HOJA DEDICADA: MOVIMIENTOS_UBICACIONES (historial completo de cambios)
    const storedMovements = this.getLocationMovements();
    const movementsList = [];

    if (Array.isArray(storedMovements) && storedMovements.length > 0) {
      storedMovements.forEach((m, idx) => {
        movementsList.push({
          'NO.': idx + 1,
          'FECHA Y HORA': m.dateFormatted || (m.timestamp ? new Date(m.timestamp).toLocaleString('es-MX', { hour12: true }) : '-'),
          'CLAVE / CÓDIGO': m.clave || m.code || '',
          'DESCRIPCIÓN': m.description || '',
          'CÓDIGO DE BARRAS': m.barcode || '',
          'UBICACIÓN ANTERIOR (PASADA)': m.prevLocation || 'Sin Asignar',
          'UBICACIÓN NUEVA (ACTUAL)': m.newLocation || 'Sin Asignar',
          'TIPO DE MOVIMIENTO': m.movementType || 'REUBICACIÓN',
          'OPERADOR RESPONSABLE': m.operator || 'Operador',
          'ORIGEN / LOTE': m.batchFolio || 'CATÁLOGO MAESTRO'
        });
      });
    }

    // Incorporar también cualquier consumible en items con estado RELOCATED que aún no esté en la lista
    items.forEach(it => {
      if (it.locationStatus === 'RELOCATED') {
        const curLoc = `${it.seccion || ''} [${it.anaquel || ''} - ${it.espacio || ''}]`.trim() || it.location || '';
        const prevLoc = it.previousLocation 
          ? (typeof it.previousLocation === 'object' ? `${it.previousLocation.seccion || ''} [${it.previousLocation.anaquel || ''} - ${it.previousLocation.espacio || ''}]`.trim() : String(it.previousLocation)) 
          : 'Sin Asignar';
        const alreadyIn = movementsList.some(m => m['CLAVE / CÓDIGO'] === it.clave && m['UBICACIÓN NUEVA (ACTUAL)'] === curLoc);
        if (!alreadyIn) {
          movementsList.push({
            'NO.': movementsList.length + 1,
            'FECHA Y HORA': it.lastVerifiedAt ? new Date(it.lastVerifiedAt).toLocaleString('es-MX', { hour12: true }) : downloadTimeStr,
            'CLAVE / CÓDIGO': it.clave || '',
            'DESCRIPCIÓN': it.nombre || '',
            'CÓDIGO DE BARRAS': Array.isArray(it.barcodes) ? it.barcodes.join(', ') : '',
            'UBICACIÓN ANTERIOR (PASADA)': prevLoc,
            'UBICACIÓN NUEVA (ACTUAL)': curLoc,
            'TIPO DE MOVIMIENTO': 'REUBICACIÓN (AMARILLO)',
            'OPERADOR RESPONSABLE': it.verifiedBy || 'Operador',
            'ORIGEN / LOTE': 'CATÁLOGO MAESTRO'
          });
        }
      }
    });

    const wsMovimientos = XLSX.utils.json_to_sheet(
      movementsList.length > 0 ? movementsList : [{
        'NO.': '',
        'FECHA Y HORA': downloadTimeStr,
        'CLAVE / CÓDIGO': 'SIN CAMBIOS REGISTRADOS',
        'DESCRIPCIÓN': 'No se han registrado reubicaciones de consumibles aún.',
        'CÓDIGO DE BARRAS': '',
        'UBICACIÓN ANTERIOR (PASADA)': '',
        'UBICACIÓN NUEVA (ACTUAL)': '',
        'TIPO DE MOVIMIENTO': '',
        'OPERADOR RESPONSABLE': '',
        'ORIGEN / LOTE': ''
      }]
    );
    wsMovimientos['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 20 },
      { wch: 40 },
      { wch: 25 },
      { wch: 30 },
      { wch: 30 },
      { wch: 26 },
      { wch: 22 },
      { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, wsMovimientos, 'MOVIMIENTOS_UBICACIONES');

    // 3. HOJA DEDICADA DE SÓLO MODIFICADOS / REUBICADOS (AMARILLO)
    const modifiedItems = items.filter(it => it.locationStatus === 'RELOCATED');
    if (modifiedItems.length > 0) {
      const modifiedRows = modifiedItems.map((it, idx) => {
        const prevLocStr = it.previousLocation 
          ? (typeof it.previousLocation === 'object' ? `${it.previousLocation.seccion || ''} [${it.previousLocation.anaquel || ''} - ${it.previousLocation.espacio || ''}]`.trim() : String(it.previousLocation)) 
          : '-';
        const curLocStr = `${it.seccion || ''} [${it.anaquel || ''} - ${it.espacio || ''}]`.trim();
        return {
          'NO.': idx + 1,
          'CLAVE': it.clave || '',
          'NOMBRE': it.nombre || '',
          'ESTADO': '⚠️ CAMBIO DE LUGAR (MODIFICADA)',
          'UBICACIÓN ANTERIOR (PASADA)': prevLocStr,
          'UBICACIÓN NUEVA (ACTUAL)': curLocStr,
          'EXISTENCIAS': it.existencias ?? 0,
          'FECHA DE CAMBIO': it.lastVerifiedAt ? new Date(it.lastVerifiedAt).toLocaleString('es-MX', { hour12: true }) : '-',
          'OPERADOR RESPONSABLE': it.verifiedBy || 'Operador'
        };
      });
      const wsModified = XLSX.utils.json_to_sheet(modifiedRows);
      wsModified['!cols'] = [
        { wch: 6 },
        { wch: 18 },
        { wch: 40 },
        { wch: 35 },
        { wch: 30 },
        { wch: 30 },
        { wch: 14 },
        { wch: 22 },
        { wch: 20 }
      ];
      XLSX.utils.book_append_sheet(wb, wsModified, 'CAMBIOS_AMARILLO');
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_Consumibles_CDM_${dateStr}.xlsx`);
  }
}
