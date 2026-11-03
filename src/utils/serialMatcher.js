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
 * Extrae la serie real si el escáner o cámara leyó un código QR con metadatos embebidos
 * (por ejemplo códigos QR de Ricoh que contienen prefijo de producto + serie + sufijo de fecha/lote,
 * o códigos de Brother concatenados / con omisión de 'U').
 */
export function extractSerialFromScanned(rawScanned) {
  if (!rawScanned) return '';
  let str = String(rawScanned).trim().toUpperCase();

  // Si viene separado por comas (formato CSV/etiqueta como "MODEL,SERIAL,EXTRA")
  if (str.includes(',')) {
    const parts = str.split(',').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const cleanPart = cleanSerialCore(part);
      if (cleanPart.length >= 7 && cleanPart.length <= 18) {
        if (/^[3WE]\d{3}(?:[A-Z]\d{6}|[A-Z]{2}\d{5})$/.test(cleanPart)) return cleanPart;
        if (/^U\d{4,5}[A-Z0-9]{7,11}$/.test(cleanPart)) return cleanPart;
      }
    }
    if (parts.length >= 2 && parts[1].length >= 6) {
      str = parts[1];
    }
  }

  const clean = cleanSerialCore(str);
  if (!clean) return '';

  // CASO A: Código QR de Ricoh
  // Ejemplos reales:
  // D0C8173911P201593102418562 -> Serie: 3911P201593 (11 caracteres)
  // D0AP173359PA00145910418490 -> Serie: 3359PA00145 (11 caracteres)
  // D0C5173371P501604105418485 -> Serie: 3371P501604 (11 caracteres)
  // Estructura: 4 dígitos (inicia en 3, W o E) + 1 letra y 6 dígitos O 2 letras y 5 dígitos = 11 caracteres
  const ricohQrMatch = clean.match(/(?:^|[A-Z0-9]*?)([3WE]\d{3}(?:[A-Z]\d{6}|[A-Z]{2}\d{5}))/);
  if (ricohQrMatch && ricohQrMatch[1]) {
    return ricohQrMatch[1];
  }

  // CASO B: Doble lectura consecutiva de Brother (30 caracteres)
  if (clean.length === 30 && /^U\d{5}[A-Z]\d[A-Z]\d{6}U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(clean)) {
    return clean.slice(0, 15);
  }

  // CASO C: Serie Brother donde la pistola omitió la 'U' inicial (14 caracteres)
  if (clean.length === 14 && /^\d{5}[A-Z]\d[A-Z]\d{6}$/.test(clean)) {
    return 'U' + clean;
  }

  // CASO D: Serie Brother embebida en un código QR más largo
  const brotherEmbeddedMatch = clean.match(/(?:^|[A-Z0-9]*?)(U\d{5}[A-Z]\d[A-Z]\d{6})/);
  if (brotherEmbeddedMatch && brotherEmbeddedMatch[1]) {
    return brotherEmbeddedMatch[1];
  }

  return clean;
}

/**
 * Calcula la distancia de edición (Levenshtein) entre dos cadenas
 */
function calculateEditDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // Eliminación
        dp[i][j - 1] + 1,      // Inserción
        dp[i - 1][j - 1] + cost // Sustitución
      );
    }
  }
  return dp[m][n];
}

/**
 * Construye el desglose carácter por carácter para resaltar visualmente las diferencias
 */
function buildCharDiff(expectedStr, scannedStr) {
  const maxLen = Math.max(expectedStr.length, scannedStr.length);
  const expectedChars = [];
  const scannedChars = [];

  // Si tienen la misma longitud, comparar posición por posición directamente
  if (expectedStr.length === scannedStr.length) {
    for (let i = 0; i < maxLen; i++) {
      const isSame = expectedStr[i] === scannedStr[i];
      expectedChars.push({ char: expectedStr[i], diff: !isSame });
      scannedChars.push({ char: scannedStr[i], diff: !isSame });
    }
    return { expectedChars, scannedChars };
  }

  // Si tienen distinta longitud, alinear prefijo común y sufijo común
  let prefixLen = 0;
  const minLen = Math.min(expectedStr.length, scannedStr.length);
  while (prefixLen < minLen && expectedStr[prefixLen] === scannedStr[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < (minLen - prefixLen) &&
    expectedStr[expectedStr.length - 1 - suffixLen] === scannedStr[scannedStr.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  for (let i = 0; i < expectedStr.length; i++) {
    const isDiff = i >= prefixLen && i < expectedStr.length - suffixLen;
    expectedChars.push({ char: expectedStr[i], diff: isDiff });
  }

  for (let i = 0; i < scannedStr.length; i++) {
    const isDiff = i >= prefixLen && i < scannedStr.length - suffixLen;
    scannedChars.push({ char: scannedStr[i], diff: isDiff });
  }

  return { expectedChars, scannedChars };
}

/**
 * Compara las series FALTANTES de un checklist contra las series que dieron ERROR (No están en la lista)
 * y devuelve las parejas con ALTO GRADO DE SIMILITUD (>= 80%, ej. 1 a 3 caracteres de diferencia por OCR).
 *
 * @param {Array} missingItems Lista de objetos { serial, material, documentName } aún no escaneados
 * @param {Array} unexpectedLogs Lista de strings (o { scannedValue }) escaneados que dieron error
 * @returns {Array} Lista de coincidencias sugeridas ordenadas de mayor a menor similitud
 */
export function findSimilarSerialMatches(missingItems = [], unexpectedLogs = []) {
  if (!missingItems?.length || !unexpectedLogs?.length) return [];

  // 1. Normalizar y desglosar los códigos de error (incluyendo lecturas dobles concatenadas o sin 'U' inicial)
  const errorCandidates = [];
  const seenErrorKeys = new Set();

  for (const rawEntry of unexpectedLogs) {
    const rawStr = typeof rawEntry === 'string'
      ? rawEntry.trim().toUpperCase()
      : String(rawEntry?.scannedValue || rawEntry?.scanned_value || rawEntry?.serial_number || '').trim().toUpperCase();

    if (!rawStr) continue;
    const clean = cleanSerialCore(rawStr);
    if (!clean || clean.length < 7) continue;

    // Caso A: Si la pistola concatenó 2 lecturas de 15 caracteres (ej. U66653F6N650212U66653F6N650210)
    if (clean.length === 30 && /^U\d{5}[A-Z]\d[A-Z]\d{6}U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(clean)) {
      const part1 = clean.slice(0, 15);
      const part2 = clean.slice(15, 30);
      if (!seenErrorKeys.has(part1)) {
        seenErrorKeys.add(part1);
        errorCandidates.push({ normalizedScanned: part1, rawUnexpected: rawStr });
      }
      if (!seenErrorKeys.has(part2)) {
        seenErrorKeys.add(part2);
        errorCandidates.push({ normalizedScanned: part2, rawUnexpected: rawStr });
      }
      continue;
    }

    // Caso B: Extraer serie si proviene de un código QR (Ricoh, Brother, etc.)
    const extracted = extractSerialFromScanned(rawStr);
    const normalized = extracted || clean;

    const key = `${normalized}|${rawStr}`;
    if (!seenErrorKeys.has(key)) {
      seenErrorKeys.add(key);
      errorCandidates.push({ normalizedScanned: normalized, rawUnexpected: rawStr });
    }
  }

  // 2. Evaluar todas las parejas posibles entre Faltantes y Errores
  const allCandidatePairs = [];

  for (const item of missingItems) {
    const expectedSerial = String(item?.serial || item?.serial_number || item || '').trim().toUpperCase();
    const expectedClean = cleanSerialCore(expectedSerial);
    if (!expectedClean) continue;

    for (const errCand of errorCandidates) {
      const scannedClean = errCand.normalizedScanned;

      // Diferencia de longitud máxima permitida: 2 caracteres
      if (Math.abs(expectedClean.length - scannedClean.length) > 2) continue;

      const maxLen = Math.max(expectedClean.length, scannedClean.length);
      const editDist = calculateEditDistance(expectedClean, scannedClean);

      // Calcular diferencias posicionales si miden lo mismo
      let posDiffs = editDist;
      if (expectedClean.length === scannedClean.length) {
        posDiffs = 0;
        for (let i = 0; i < expectedClean.length; i++) {
          if (expectedClean[i] !== scannedClean[i]) posDiffs++;
        }
      }

      const effectiveDiffs = Math.min(editDist, posDiffs);
      const similarityPercent = Math.round(((maxLen - effectiveDiffs) / maxLen) * 100);

      // Verificar si comparten el mismo prefijo de lote Brother (9 caracteres) y terminación similar
      const samePrefix9 =
        expectedClean.length >= 13 &&
        scannedClean.length >= 13 &&
        expectedClean.slice(0, 9) === scannedClean.slice(0, 9);

      const sameLast2 = expectedClean.slice(-2) === scannedClean.slice(-2);
      const sameLast3 = expectedClean.slice(-3) === scannedClean.slice(-3);

      // Filtro de ALTO GRADO DE SIMILITUD:
      // - Al menos 80% de similitud (máximo 3 caracteres distintos en series de 15 caracteres)
      // - Y si hay 2 o 3 diferencias, exigir que compartan prefijo de 9 caracteres o los últimos dígitos finales
      const isHighSimilarity =
        effectiveDiffs <= 1 ||
        (effectiveDiffs === 2 && (samePrefix9 || sameLast2)) ||
        (effectiveDiffs === 3 && samePrefix9 && sameLast3);

      if (!isHighSimilarity || similarityPercent < 80) continue;

      // Puntaje de prioridad para emparejar cada faltante con su mejor lectura física
      let score = similarityPercent * 10;
      if (samePrefix9) score += 50;
      if (sameLast3) score += 80;
      else if (sameLast2) score += 40;

      const { expectedChars, scannedChars } = buildCharDiff(expectedSerial, scannedClean);

      let reasonLabel = `${effectiveDiffs} ${effectiveDiffs === 1 ? 'dígito diferente' : 'dígitos diferentes'}`;
      if (errCand.rawUnexpected !== scannedClean && errCand.rawUnexpected.length === 14) {
        reasonLabel = 'Pistola omitió la "U" inicial';
      } else if (samePrefix9 && sameLast3) {
        reasonLabel = `Mismo prefijo y misma terminación (${expectedClean.slice(-3)})`;
      }

      allCandidatePairs.push({
        expectedSerial,
        scannedSerial: scannedClean,
        rawUnexpected: errCand.rawUnexpected,
        material: item?.material || 'SIN MODELO',
        documentName: item?.documentName || '',
        similarityPercent,
        effectiveDiffs,
        reasonLabel,
        expectedChars,
        scannedChars,
        score
      });
    }
  }

  // 3. Emparejamiento 1 a 1 codicioso (Greedy Best-Match) para no repetir la misma serie
  allCandidatePairs.sort((a, b) => b.score - a.score);

  const usedExpected = new Set();
  const usedScanned = new Set();
  const finalMatches = [];

  for (const pair of allCandidatePairs) {
    if (usedExpected.has(pair.expectedSerial) || usedScanned.has(pair.scannedSerial)) {
      continue;
    }
    usedExpected.add(pair.expectedSerial);
    usedScanned.add(pair.scannedSerial);
    finalMatches.push(pair);
  }

  return finalMatches;
}

/**
 * Busca de forma inteligente una serie en una lista de equipos.
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

  // Extraer serie canónica de QR (Ricoh, Brother, etc.)
  const extractedSerial = extractSerialFromScanned(rawScanned);

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
    if (s === scannedUpper || s === scannedClean || (extractedSerial && s === extractedSerial)) return item;
  }

  // Nivel 2: Coincidencia de Núcleo Limpio (resuelve paréntesis, puntos y ceros a la izquierda)
  for (const item of items) {
    const s = getSerial(item);
    const itemClean = cleanSerialCore(s);
    if (itemClean === scannedClean || (extractedSerial && itemClean === extractedSerial)) return item;
  }

  // Nivel 3: Coincidencia de QR Embebido / Contención de Subcadena
  // Resuelve el caso en que el QR físico contiene metadatos de producto/fábrica (ej. Ricoh D0C8173911P201593102418562)
  // y la serie esperada está contenida dentro de esa cadena de texto
  let bestSubMatch = null;
  let maxSubMatchLen = 0;

  for (const item of items) {
    const itemClean = cleanSerialCore(getSerial(item));
    if (!itemClean || itemClean.length < 7) continue;

    // Caso A: La cadena escaneada (QR) CONTIENE la serie esperada
    if (scannedClean.includes(itemClean)) {
      if (itemClean.length > maxSubMatchLen) {
        maxSubMatchLen = itemClean.length;
        bestSubMatch = item;
      }
    }
    // Caso B: La serie extraída del QR coincide con la serie del equipo
    else if (extractedSerial && extractedSerial.length >= 7) {
      if (itemClean.includes(extractedSerial) || extractedSerial.includes(itemClean)) {
        if (itemClean.length > maxSubMatchLen) {
          maxSubMatchLen = itemClean.length;
          bestSubMatch = item;
        }
      }
    }
  }

  if (bestSubMatch) {
    return bestSubMatch;
  }

  // Nivel 4: Ceros de relleno al final (ej: 12345678 vs 123456780 o 1234567800)
  for (const item of items) {
    const itemClean = cleanSerialCore(getSerial(item));
    if (!itemClean) continue;

    if (itemClean.startsWith(scannedClean)) {
      const suffix = itemClean.slice(scannedClean.length);
      if (/^0+$/.test(suffix)) return item;
    }

    if (scannedClean.startsWith(itemClean)) {
      const suffix = scannedClean.slice(itemClean.length);
      if (/^0+$/.test(suffix)) return item;
    }
  }

  // Nivel 5: Prefijos comunes de fabricante (SN, S, P/N, (S), etc.)
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
