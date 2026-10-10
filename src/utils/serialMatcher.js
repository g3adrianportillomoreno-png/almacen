/**
 * Utilidad de Coincidencia Inteligente de Números de Serie
 * Resuelve discrepancias cuando los sistemas agregan ceros adicionales, puntos,
 * paréntesis o prefijos a las series en el archivo Excel o en el código físico.
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
  const scannedClean = cleanSerialCore(rawScanned);

  if (!scannedClean) return null;

  // Nivel 1: Coincidencia Exacta
  for (const item of items) {
    const s = String(getSerial(item) || '').trim().toUpperCase();
    if (s === scannedUpper) return item;
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

  return null;
}
