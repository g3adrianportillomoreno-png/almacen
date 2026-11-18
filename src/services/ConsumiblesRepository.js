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
        const existingBarcodes = Array.isArray(item.barcodes) ? item.barcodes : [];
        if (!existingBarcodes.includes(barcode)) {
          existingBarcodes.push(barcode);
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
  static exportToExcel(items = []) {
    if (!items || items.length === 0) {
      alert('No hay consumibles para exportar.');
      return;
    }

    const rows = items.map((it, idx) => ({
      'No.': idx + 1,
      'Clave': it.clave || '',
      'Códigos de Barras Vinculados': Array.isArray(it.barcodes) ? it.barcodes.join(', ') : '',
      'Nombre': it.nombre || '',
      'Categoría': it.categoria || '',
      'Existencias': it.existencias ?? 0,
      'Zona': it.zona || '',
      'Sección': it.seccion || '',
      'Anaquel': it.anaquel || '',
      'Espacio': it.espacio || '',
      'Almacén': it.almacen || 'Principal',
      'Stock Min.': it.stock_min ?? 0,
      'Stock Max.': it.stock_max ?? 0
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 25 },
      { wch: 45 },
      { wch: 22 },
      { wch: 12 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'CONSUMIBLES_CATALOGO');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_Consumibles_CDM_${dateStr}.xlsx`);
  }
}
