/**
 * Utilidad de Coincidencia Inteligente de Números de Serie
 * Resuelve discrepancias cuando los sistemas agregan ceros adicionales, puntos,
 * paréntesis, prefijos, omisión de 'U' inicial por pistola láser o variaciones de 1 dígito de OCR.
 */

/**
 * Limpia y normaliza una serie eliminando caracteres especiales, espacios y ceros iniciales
 */
export function cleanSerialCore(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toUpperCase()
    .replace(/[\(\)\[\]\{\}\.\-_/\\,\s]/g, '') // Quita paréntesis, corchetes, puntos, guiones, barras, comas, espacios
    .replace(/^0+/, '');                        // Quita ceros a la izquierda
}

/**
 * Busca de forma inteligente una serie en una lista de equipos.
 * Casos cubiertos:
 *  - Coincidencia exacta (ej: 12345678 == 12345678)
 *  - Ceros al inicio (ej: 12345678 == 012345678)
 *  - Puntos o símbolos al final (ej: 12345678 == 12345678.)
 *  - Paréntesis (ej: 12345678 == (12345678))
 *  - Ceros al final agregados por sistemas (ej: 12345678 == 123456780 o 1234567800)
 *  - Prefijos comunes de código de barras (ej: (S)12345678, SN12345678)
 *  - Pistola láser que omitió la 'U' inicial en series Brother (ej: 66653F6N650240 -> U66653F6N650240)
 *  - Tolerancia segura a 1 dígito de OCR en el sub-prefijo consecutivo de series Brother de 15 caracteres
 *
 * @param {string} rawScanned Código escaneado con pistola o cámara
 * @param {Array} items Lista de equipos u objetos
 * @param {Function} getSerial Función extractora de serie
 * @returns {Object|null} El elemento encontrado o null
 */
export function findSerialMatch(
  rawScanned, 
  items = [], 
  getSerial = (item) => (item?.serial || item?.serial_number || item)
) {
  if (!rawScanned || !items || !items.length) return null;

  const scannedUpper = String(rawScanned).trim().toUpperCase();
  let scannedClean = cleanSerialCore(rawScanned);

  if (!scannedClean) return null;

  // Si la pistola láser omitió la 'U' inicial en una serie Brother de 14 caracteres (ej: 66653F6N650240)
  if (scannedClean.length === 14 && /^\d{5}[A-Z]\d[A-Z]\d{6}$/.test(scannedClean)) {
    scannedClean = 'U' + scannedClean;
  }

  // Si la pistola concatenó dos lecturas seguidas de 15 caracteres (ej: U66653F6N650212U66653F6N650210)
  if (scannedClean.length === 30 && /^U\d{5}[A-Z]\d[A-Z]\d{6}U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(scannedClean)) {
    const first15 = scannedClean.slice(0, 15);
    const second15 = scannedClean.slice(15, 30);
    const firstMatch = items.find((item) => cleanSerialCore(getSerial(item)) === first15 && !item?.is_scanned);
    if (firstMatch) return firstMatch;
    const secondMatch = items.find((item) => cleanSerialCore(getSerial(item)) === second15 && !item?.is_scanned);
    if (secondMatch) return secondMatch;
    scannedClean = first15;
  }

  // Nivel 1: Coincidencia Exacta
  for (const item of items) {
    const s = String(getSerial(item) || '').trim().toUpperCase();
    if (s === scannedUpper || s === scannedClean) return item;
  }

  // Nivel 2: Coincidencia de Núcleo Limpio (resuelve paréntesis, puntos y ceros a la izquierda)
  for (const item of items) {
    const s = getSerial(item);
    if (cleanSerialCore(s) === scannedClean) return item;
  }

  // Nivel 3: Ceros de relleno al final (ej: 12345678 vs 123456780 o 1234567800)
  for (const item of items) {
    const itemClean = cleanSerialCore(getSerial(item));
    if (!itemClean) continue;

    // Si el registro del Excel empieza con lo escaneado y lo que sobra son ÚNICAMENTE ceros
    if (itemClean.startsWith(scannedClean)) {
      const suffix = itemClean.slice(scannedClean.length);
      if (/^0+$/.test(suffix)) return item;
    }

    // O viceversa: si lo escaneado traía ceros al final que el Excel no tiene
    if (scannedClean.startsWith(itemClean)) {
      const suffix = scannedClean.slice(itemClean.length);
      if (/^0+$/.test(suffix)) return item;
    }
  }

  // Nivel 4: Prefijos comunes de fabricante (SN, S, P/N, (S), etc.)
  for (const item of items) {
    const itemClean = cleanSerialCore(getSerial(item));
    if (!itemClean) continue;

    const strippedItem = itemClean.replace(/^(SN|S|NO|NUM)/, '');
    const strippedScanned = scannedClean.replace(/^(SN|S|NO|NUM)/, '');

    if (strippedItem === strippedScanned || strippedItem === scannedClean || itemClean === strippedScanned) {
      return item;
    }
  }

  // Nivel 5: Tolerancia segura a 1 dígito de OCR en series Brother de 15 caracteres (ej. U66653F6N350226 vs U66653F6N650226)
  // Solo aplica si:
  //  - El código escaneado tiene estructura Brother de 15 caracteres (^U\d{5}[A-Z]\d[A-Z]\d{6}$)
  //  - Coincide exactamente el prefijo de 9 caracteres (modelo + mes + año + planta)
  //  - Coinciden exactamente los últimos 3 dígitos finales del número de serie
  //  - Existe UN SOLO candidato pendiente en el checklist con distancia de 1 dígito o 1 desplazamiento en pos 9..12
  if (scannedClean.length === 15 && /^U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(scannedClean)) {
    const scanPrefix9 = scannedClean.slice(0, 9);
    const scanMid3 = scannedClean.slice(9, 12);
    const scanLast3 = scannedClean.slice(12, 15);

    const fuzzyCandidates = [];
    for (const item of items) {
      if (item?.is_scanned || item?.scanned) continue;
      const itemClean = cleanSerialCore(getSerial(item));
      if (itemClean.length !== 15 || !itemClean.startsWith(scanPrefix9)) continue;
      if (itemClean.slice(12, 15) !== scanLast3) continue;

      const itemMid3 = itemClean.slice(9, 12);
      let diffs = 0;
      for (let k = 0; k < 3; k++) {
        if (scanMid3[k] !== itemMid3[k]) diffs++;
      }

      // 1 dígito de diferencia (ej. 650 vs 350, 649 vs 642) o desplazamiento de 2 dígitos (ej. 649 vs 492)
      const isShifted = scanMid3.slice(1) === itemMid3.slice(0, 2);
      if (diffs === 1 || isShifted) {
        fuzzyCandidates.push(item);
      }
    }

    if (fuzzyCandidates.length === 1) {
      return fuzzyCandidates[0];
    }
  }

  return null;
}
