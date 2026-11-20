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

  static getAliases() {
    return ConsumiblesRepository.getBarcodeAliases();
  }

  /**
   * Vincula un código de barras nuevo (ej. EAN 6920952323115) a un consumible
   */
  static async linkBarcode(barcode, claveOrId) {
    return await ConsumiblesRepository.linkBarcodeToConsumible(barcode, claveOrId);
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
   * 0. Código de barras escaneado previamente vinculado (ej. EAN 6920952323115)
   * 1. Clave exacta
   * 2. Clave normalizada o numérica (ej. 03847 -> IK03847)
   * 3. Subcadenas
   * 4. Número de parte / modelo presente en el nombre del producto
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

    // 0. Revisar si coincide con un código de barras previamente vinculado (EAN/UPC/Serie de caja)
    const aliases = this.getAliases();
    const mappedClave = aliases[query] || aliases[cleanQuery];
    if (mappedClave) {
      const foundByAlias = catalog.find(
        item => String(item.clave || '').trim().toUpperCase() === String(mappedClave).trim().toUpperCase()
      );
      if (foundByAlias) {
        return {
          match: foundByAlias,
          candidates: [foundByAlias],
          matchedByBarcode: true,
          scannedCode: query
        };
      }
    }

    // También revisar en el campo barcodes de cada consumible directamente
    const foundDirectBarcode = catalog.find(item => {
      if (!Array.isArray(item.barcodes)) return false;
      return item.barcodes.some(b => {
        const cleanB = this.cleanString(b);
        return cleanB === cleanQuery || String(b).trim() === query;
      });
    });

    if (foundDirectBarcode) {
      return {
        match: foundDirectBarcode,
        candidates: [foundDirectBarcode],
        matchedByBarcode: true,
        scannedCode: query
      };
    }

    // 1. Coincidencia exacta estricta en Clave
    const exact = catalog.find(item => String(item.clave || '').trim().toUpperCase() === queryUpper);
    if (exact) {
      return { match: exact, candidates: [exact] };
    }

    // 2. Coincidencia limpia en Clave y búsqueda ponderada
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
      } else if (cleanClave.endsWith(cleanQuery) && cleanQuery.length >= 2) {
        // e.g. "03847" coincide con "IK03847"
        score = 90;
        reason = 'Número de clave coincidente';
      } else if (cleanClave.startsWith(cleanQuery) && cleanQuery.length >= 2) {
        score = 85;
        reason = 'Clave comienza con código';
      } else if (cleanClave.includes(cleanQuery) && cleanQuery.length >= 2) {
        score = 75;
        reason = 'Clave contiene código';
      } else if (cleanQuery.length >= 3 && cleanQuery.includes(cleanClave)) {
        score = 70;
        reason = 'Código contiene clave';
      } else if (cleanName.includes(cleanQuery) && cleanQuery.length >= 2) {
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
      return { match: null, candidates: [], scannedCode: query };
    }

    // Ordenar de mayor a menor puntuación
    scoredList.sort((a, b) => b.score - a.score);

    const best = scoredList[0].item;
    const candidates = scoredList.slice(0, 10).map(s => s.item);

    return {
      match: best,
      candidates,
      scannedCode: query
    };
  }

  /**
   * Búsqueda predictiva rápida y ponderada para autocompletar mientras el operador escribe.
   * Devuelve los candidatos ordenados por relevancia directa en clave y modelo.
   */
  static searchPredictive(rawText, catalog = [], limit = 15) {
    if (!rawText || !rawText.trim() || !Array.isArray(catalog)) return [];
    
    const query = rawText.trim();
    const queryUpper = query.toUpperCase();
    const queryLower = query.toLowerCase();
    const cleanQuery = this.cleanString(query);
    const tokens = queryLower.split(/\s+/).filter(t => t.length > 0);

    const scored = [];

    catalog.forEach(item => {
      const itemClave = String(item.clave || '').trim();
      const cleanClave = this.cleanString(itemClave);
      const claveUpper = itemClave.toUpperCase();
      const claveLower = itemClave.toLowerCase();

      const itemName = String(item.nombre || '').trim();
      const cleanName = this.cleanString(itemName);
      const nameUpper = itemName.toUpperCase();
      const nameLower = itemName.toLowerCase();

      const catLower = String(item.categoria || '').toLowerCase();
      const secLower = String(item.seccion || '').toLowerCase();
      const anaqLower = String(item.anaquel || '').toLowerCase();
      const barcodes = Array.isArray(item.barcodes) ? item.barcodes : [];

      let score = 0;
      let matchReason = '';

      // 1. Coincidencia en Clave
      if (claveUpper === queryUpper) {
        score += 2000;
        matchReason = 'Clave exacta';
      } else if (cleanClave === cleanQuery && cleanQuery.length > 0) {
        score += 1500;
        matchReason = 'Clave normalizada';
      } else if (cleanClave.startsWith(cleanQuery) && cleanQuery.length >= 1) {
        score += 1000 + (cleanQuery.length * 10);
        matchReason = 'Comienza con clave';
      } else if (cleanClave.endsWith(cleanQuery) && cleanQuery.length >= 2) {
        score += 900 + (cleanQuery.length * 10);
        matchReason = 'Termina con modelo/número';
      } else if (cleanClave.includes(cleanQuery) && cleanQuery.length >= 2) {
        score += 700 + (cleanQuery.length * 10);
        matchReason = 'Clave contiene texto';
      }

      // 2. Coincidencia en códigos de barra asociados
      const matchedBarcode = barcodes.find(b => {
        const cleanB = this.cleanString(b);
        return cleanB === cleanQuery || String(b).includes(query);
      });
      if (matchedBarcode) {
        score += 800;
        if (!matchReason) matchReason = `Código vinculado: ${matchedBarcode}`;
      }

      // 3. Coincidencia en Nombre / Descripción
      if (nameUpper.includes(`(${queryUpper})`)) {
        score += 600;
        if (!matchReason) matchReason = 'Modelo exacto en descripción';
      } else if (nameUpper.includes(queryUpper)) {
        score += 400;
        if (!matchReason) matchReason = 'Texto en descripción';
      } else if (cleanQuery.length >= 2 && cleanName.includes(cleanQuery)) {
        score += 300;
        if (!matchReason) matchReason = 'Coincidencia en nombre';
      }

      // 4. Tokens múltiples
      if (tokens.length > 1) {
        const fullHaystack = `${claveLower} ${nameLower} ${catLower} ${secLower} ${anaqLower} ${barcodes.join(' ').toLowerCase()}`;
        const allPresent = tokens.every(tok => fullHaystack.includes(tok));
        if (allPresent) {
          score += 250;
          if (!matchReason) matchReason = 'Coinciden palabras';
        }
      }

      if (score > 0) {
        scored.push({
          ...item,
          _score: score,
          _matchReason: matchReason
        });
      }
    });

    // Ordenar de mayor a menor relevancia
    scored.sort((a, b) => b._score - a._score);

    return scored.slice(0, limit);
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
