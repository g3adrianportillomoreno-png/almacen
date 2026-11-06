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
export function buildCharDiff(expectedStr, scannedStr) {
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

  // Nivel 0: Búsqueda directa por Número de SANTI / Número Interno de Equipo (ej: #21465 o 21465)
  // En SANTI, no existen dos impresoras con el mismo número interno, por lo que es un identificador único directo.
  const rawCleanNum = String(rawScanned).trim().replace(/^#/, '').trim();
  if (rawCleanNum && /^\d+$/.test(rawCleanNum)) {
    // Si viene precedido de '#' o es un número puro, buscar coincidencia por internalNumber
    const santiMatch = items.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const num = item?.internalNumber !== undefined && item?.internalNumber !== null
        ? String(item.internalNumber).trim().replace(/^#/, '')
        : (item?.internal_number !== undefined && item?.internal_number !== null
            ? String(item.internal_number).trim().replace(/^#/, '')
            : '');
      return num === rawCleanNum;
    });

    // Si viene explícitamente con '#', dar prioridad absoluta al número de SANTI
    if (String(rawScanned).trim().startsWith('#') && santiMatch) {
      return santiMatch;
    }

    // Si no tiene '#' pero coincide con número interno y ninguna serie coincide de forma exacta primero
    if (santiMatch) {
      const hasExactSerial = items.some(item => {
        const s = String(getSerial(item) || '').trim().toUpperCase();
        return s === scannedUpper;
      });
      if (!hasExactSerial) {
        return santiMatch;
      }
    }
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

  // Nivel 4: Ceros de relleno al final (ej: W758L700142 vs W758L7001420 o W758L70014200 en SANTI)
  const trailingTargets = Array.from(new Set([scannedClean, extractedSerial].filter(Boolean)));
  for (const item of items) {
    const itemClean = cleanSerialCore(getSerial(item));
    if (!itemClean) continue;

    for (const tgt of trailingTargets) {
      if (itemClean.startsWith(tgt)) {
        const suffix = itemClean.slice(tgt.length);
        if (/^0+$/.test(suffix)) return item;
      }

      if (tgt.startsWith(itemClean)) {
        const suffix = tgt.slice(itemClean.length);
        if (/^0+$/.test(suffix)) return item;
      }

      if (
        itemClean.length >= 6 &&
        tgt.length >= 6 &&
        itemClean.replace(/0+$/, '') === tgt.replace(/0+$/, '')
      ) {
        return item;
      }
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

/**
 * Busca candidatos similares en una lista de equipos para un código escaneado.
 * Especialmente optimizado para el caso de SANTI donde se agregan ceros adicionales al final,
 * códigos QR con metadatos embebidos, o diferencias menores de caracteres.
 *
 * @param {string} rawScanned Código escaneado con pistola o cámara
 * @param {Array} items Lista de equipos u objetos
 * @param {Function} getSerial Función extractora de serie
 * @param {number} maxResults Cantidad máxima de candidatos a retornar (default: 6)
 * @returns {Array} Lista de candidatos ordenados por puntuación de similitud
 */
export function findSimilarCandidates(
  rawScanned,
  items = [],
  getSerial = (item) => (item?.serial || item?.serial_number || item),
  maxResults = 6
) {
  if (!rawScanned || !items || !items.length) return [];

  const scannedRaw = String(rawScanned).trim().toUpperCase();
  const scannedClean = cleanSerialCore(scannedRaw);
  if (!scannedClean) return [];

  const extractedSerial = extractSerialFromScanned(scannedRaw);
  const targets = Array.from(new Set([scannedClean, extractedSerial, scannedRaw].filter(Boolean)));

  const candidates = [];
  const seenSerials = new Set();

  // Nivel 0: Búsqueda de candidatos por Número SANTI (#21465 o 21465)
  const rawNumQuery = String(rawScanned).trim().replace(/^#/, '').trim();
  if (rawNumQuery && /^\d+$/.test(rawNumQuery)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const num = item?.internalNumber !== undefined && item?.internalNumber !== null
        ? String(item.internalNumber).trim().replace(/^#/, '')
        : (item?.internal_number !== undefined && item?.internal_number !== null
            ? String(item.internal_number).trim().replace(/^#/, '')
            : '');
      if (num === rawNumQuery) {
        const rawExpected = String(getSerial(item) || '').trim().toUpperCase();
        seenSerials.add(rawExpected);
        candidates.push({
          item,
          serial: rawExpected,
          cleanSerial: cleanSerialCore(rawExpected),
          material: item?.material || item?.model || 'EQUIPO',
          batchFolio: item?.batchFolio || item?.documentName || '',
          warehouseLocation: item?.warehouseName && item?.warehouseRow && item?.warehouseRow !== 'Sin Asignar'
            ? `${item.warehouseName} → ${item.warehouseRow} [${item.warehouseSpace || 'S/E'}]`
            : 'Pendiente de Ubicación',
          isUnassigned: !item?.warehouseSpace || !item?.warehouseRow || item?.warehouseRow === 'Sin Asignar' || (typeof item?.warehouseSpace === 'string' && item.warehouseSpace.trim() === ''),
          score: 100,
          rawScore: 100,
          reason: `Número SANTI exacto (#${rawNumQuery})`,
          matchType: 'SANTI_INTERNAL_NUMBER',
          expectedChars: rawExpected.split('').map(c => ({ char: c, type: 'match' })),
          scannedChars: String(rawScanned).split('').map(c => ({ char: c, type: 'match' }))
        });
      }
    }
  }

  for (const item of items) {
    const rawExpected = String(getSerial(item) || '').trim().toUpperCase();
    if (!rawExpected || seenSerials.has(rawExpected)) continue;
    const expectedClean = cleanSerialCore(rawExpected);
    if (!expectedClean) continue;

    let bestScore = 0;
    let bestReason = '';
    let matchType = '';
    let matchedTarget = scannedClean;

    for (const target of targets) {
      if (!target) continue;

      // 0. Coincidencia por núcleo normalizado (diferencia de ceros iniciales o formato)
      if (expectedClean === target) {
        const score = 99;
        if (score > bestScore) {
          bestScore = score;
          bestReason = 'Coincidencia exacta sin ceros iniciales de SANTI';
          matchType = 'LEADING_ZEROS_SANTI';
          matchedTarget = target;
        }
      }

      // 1. Ceros al final en SANTI (ej: Físico W758L700142 -> SANTI W758L7001420 o W758L70014200)
      if (expectedClean.startsWith(target) && /^0+$/.test(expectedClean.slice(target.length))) {
        const extraZeros = expectedClean.slice(target.length);
        const score = 99 - (extraZeros.length * 2);
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Ceros adicionales en SANTI (+${extraZeros})`;
          matchType = 'TRAILING_ZEROS_SANTI';
          matchedTarget = target;
        }
      }
      // 1b. Ceros al final en el escaneo y SANTI tiene la serie más corta
      else if (target.startsWith(expectedClean) && /^0+$/.test(target.slice(expectedClean.length))) {
        const extraZeros = target.slice(expectedClean.length);
        const score = 97 - (extraZeros.length * 2);
        if (score > bestScore) {
          bestScore = score;
          bestReason = `Escaneo con ceros al final (+${extraZeros})`;
          matchType = 'TRAILING_ZEROS_SCAN';
          matchedTarget = target;
        }
      }
      // 1c. Misma raíz eliminando ceros al final en ambos lados
      else if (
        expectedClean.replace(/0+$/, '').length >= 6 &&
        expectedClean.replace(/0+$/, '') === target.replace(/0+$/, '')
      ) {
        const score = 96;
        if (score > bestScore) {
          bestScore = score;
          bestReason = 'Misma serie base con variación de ceros finales en SANTI';
          matchType = 'TRAILING_ZEROS_DIFF';
          matchedTarget = target;
        }
      }

      // 2. Contenido en código QR de fabricante o subcadena
      if (target.length > expectedClean.length && target.includes(expectedClean) && expectedClean.length >= 7) {
        const score = 94;
        if (score > bestScore) {
          bestScore = score;
          bestReason = 'Serie de SANTI contenida en código QR físico';
          matchType = 'QR_CONTAINS';
          matchedTarget = target;
        }
      } else if (expectedClean.length > target.length && expectedClean.includes(target) && target.length >= 7) {
        const score = 92;
        if (score > bestScore) {
          bestScore = score;
          bestReason = 'Serie de SANTI contiene el código leído';
          matchType = 'CONTAINS_SCAN';
          matchedTarget = target;
        }
      }

      // 3. Similitud por distancia de edición (Levenshtein) si longitudes cercanas
      const lenDiff = Math.abs(expectedClean.length - target.length);
      if (lenDiff <= 2 && expectedClean.length >= 7 && target.length >= 7) {
        const maxLen = Math.max(expectedClean.length, target.length);
        const editDist = calculateEditDistance(expectedClean, target);

        let posDiffs = editDist;
        if (expectedClean.length === target.length) {
          posDiffs = 0;
          for (let i = 0; i < maxLen; i++) {
            if (expectedClean[i] !== target[i]) posDiffs++;
          }
        }
        const effectiveDiffs = Math.min(editDist, posDiffs);
        const similarity = Math.round(((maxLen - effectiveDiffs) / maxLen) * 100);

        if (similarity >= 75 && effectiveDiffs <= 2) {
          const score = similarity;
          if (score > bestScore) {
            bestScore = score;
            bestReason = `${similarity}% similitud (${effectiveDiffs} ${effectiveDiffs === 1 ? 'dígito diferente' : 'dígitos diferentes'})`;
            matchType = 'EDIT_SIMILARITY';
            matchedTarget = target;
          }
        }
      }
    }

    // Si tiene una coincidencia relevante
    if (bestScore >= 70) {
      seenSerials.add(rawExpected);
      const isUnassigned = !item?.warehouseSpace || !item?.warehouseRow || item?.warehouseRow === 'Sin Asignar' || (typeof item?.warehouseSpace === 'string' && item.warehouseSpace.trim() === '');

      // Priorizar equipos pendientes de acomodo
      let finalScore = bestScore;
      if (isUnassigned) {
        finalScore += 5;
      }

      const { expectedChars, scannedChars } = buildCharDiff(rawExpected, matchedTarget);

      candidates.push({
        item,
        serial: rawExpected,
        cleanSerial: expectedClean,
        material: item?.material || item?.model || 'EQUIPO',
        batchFolio: item?.batchFolio || item?.documentName || '',
        warehouseLocation: item?.warehouseName && item?.warehouseRow && item?.warehouseRow !== 'Sin Asignar'
          ? `${item.warehouseName} → ${item.warehouseRow} [${item.warehouseSpace || 'S/E'}]`
          : 'Pendiente de Ubicación',
        isUnassigned,
        score: finalScore,
        rawScore: bestScore,
        reason: bestReason,
        matchType,
        expectedChars,
        scannedChars
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxResults);
}
