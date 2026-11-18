// src/controllers/ConsumiblesController.js
import { ConsumiblesRepository } from '../services/ConsumiblesRepository.js';

export class ConsumiblesController {
  static async loadCatalog() {
    return await ConsumiblesRepository.getAllConsumibles();
  }

  static async saveCatalog(items) {
    return await ConsumiblesRepository.saveAllConsumibles(items);
  }

  static async updateItem(id, patch) {
    return await ConsumiblesRepository.updateConsumible(id, patch);
  }

  static async importExcel(file) {
    return await ConsumiblesRepository.importFromExcel(file);
  }

  static exportExcel(items) {
    return ConsumiblesRepository.exportToExcel(items);
  }

  /**
   * Limpia y normaliza una cadena quitando caracteres especiales y espacios
   */
  static cleanString(str) {
    return String(str || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Búsqueda inteligente y tolerante de consumibles por código de barras o clave
   * Puede coincidir con:
   * 1. Clave exacta
   * 2. Clave normalizada (sin guiones, barras, espacios)
   * 3. Subcadenas (si el código está contenido en la clave o la clave en el código)
   * 4. Número de parte / modelo presente en el nombre del producto (ej. entre paréntesis o texto)
   */
  static findMatch(rawQuery, catalog = []) {
    if (!rawQuery || !Array.isArray(catalog) || catalog.length === 0) {
      return { match: null, candidates: [] };
    }

    const query = String(rawQuery).trim();
    const queryUpper = query.toUpperCase();
    const cleanQuery = this.cleanString(query);

    if (!cleanQuery) {
      return { match: null, candidates: [] };
    }

    // 1. Coincidencia exacta estricta en Clave
    const exact = catalog.find(item => String(item.clave || '').trim().toUpperCase() === queryUpper);
    if (exact) {
      return { match: exact, candidates: [exact] };
    }

    // 2. Coincidencia limpia en Clave (ej: C-TN227BK vs TN227BK o CTN227BK)
    const scoredList = [];

    catalog.forEach(item => {
      const itemClave = String(item.clave || '').trim();
      const cleanClave = this.cleanString(itemClave);
      const itemName = String(item.nombre || '').trim();
      const cleanName = this.cleanString(itemName);

      let score = 0;
      let reason = '';

      if (cleanClave === cleanQuery) {
        score = 100;
        reason = 'Clave idéntica';
      } else if (cleanClave.endsWith(cleanQuery) || cleanClave.startsWith(cleanQuery)) {
        score = 85;
        reason = 'Clave prefijo/sufijo';
      } else if (cleanClave.includes(cleanQuery)) {
        score = 75;
        reason = 'Clave contiene código';
      } else if (cleanQuery.length >= 4 && cleanQuery.includes(cleanClave)) {
        score = 70;
        reason = 'Código contiene clave';
      } else if (cleanName.includes(cleanQuery) && cleanQuery.length >= 3) {
        // Verificar si está entre paréntesis o separado en el nombre
        if (itemName.toUpperCase().includes(`(${queryUpper})`)) {
          score = 80;
          reason = 'Modelo exacto en paréntesis';
        } else if (itemName.toUpperCase().includes(queryUpper)) {
          score = 65;
          reason = 'Modelo en nombre';
        } else {
          score = 50;
          reason = 'Coincidencia parcial en nombre';
        }
      }

      if (score > 0) {
        scoredList.push({ item, score, reason });
      }
    });

    if (scoredList.length === 0) {
      return { match: null, candidates: [] };
    }

    // Ordenar de mayor a menor puntuación
    scoredList.sort((a, b) => b.score - a.score);

    const best = scoredList[0].item;
    const candidates = scoredList.slice(0, 5).map(s => s.item);

    return {
      match: best,
      candidates
    };
  }

  /**
   * Devuelve un formato legible de la ubicación física completa
   */
  static getLocationDisplay(item) {
    if (!item) return { fullText: 'Sin Ubicación', hasLocation: false };
    const parts = [];
    if (item.zona) parts.push(`Zona: ${item.zona}`);
    if (item.seccion) parts.push(`Sección: ${item.seccion}`);
    if (item.anaquel) parts.push(`Anaquel: ${item.anaquel}`);
    if (item.espacio) parts.push(`Espacio: ${item.espacio}`);

    const hasLocation = parts.length > 0;
    return {
      fullText: hasLocation ? parts.join(' • ') : 'Sin Ubicación Asignada',
      hasLocation,
      zona: item.zona || '',
      seccion: item.seccion || 'N/A',
      anaquel: item.anaquel || 'N/A',
      espacio: item.espacio || 'N/A',
      almacen: item.almacen || 'Principal'
    };
  }

  /**
   * Evalúa el estado del stock según existencias, stock_min y stock_max
   */
  static getStockStatus(item) {
    if (!item) return { label: 'Desconocido', color: 'bg-slate-500 text-white', status: 'UNKNOWN' };
    const existencias = Number(item.existencias) || 0;
    const stockMin = Number(item.stock_min) || 0;
    const stockMax = Number(item.stock_max) || 0;

    if (existencias <= 0) {
      return {
        label: 'Agotado (0 existencias)',
        badgeClass: 'bg-rose-600 text-white border-rose-700',
        cardClass: 'border-rose-300 bg-rose-50/50',
        status: 'OUT_OF_STOCK'
      };
    }

    if (stockMin > 0 && existencias <= stockMin) {
      return {
        label: `Stock Bajo (Mín: ${stockMin})`,
        badgeClass: 'bg-amber-500 text-slate-900 border-amber-600 font-bold',
        cardClass: 'border-amber-300 bg-amber-50/50',
        status: 'LOW_STOCK'
      };
    }

    if (stockMax > 0 && existencias > stockMax) {
      return {
        label: `Sobre Stock (Máx: ${stockMax})`,
        badgeClass: 'bg-purple-600 text-white border-purple-700',
        cardClass: 'border-purple-300 bg-purple-50/50',
        status: 'OVER_STOCK'
      };
    }

    return {
      label: 'Stock Normal',
      badgeClass: 'bg-emerald-600 text-white border-emerald-700',
      cardClass: 'border-emerald-300 bg-emerald-50/50',
      status: 'NORMAL'
    };
  }
}
