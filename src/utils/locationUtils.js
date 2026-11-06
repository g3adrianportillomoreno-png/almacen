/**
 * Utilidades para el manejo de ubicaciones y asignación consecutiva de espacios.
 */

/**
 * Calcula el siguiente espacio consecutivo a partir de un valor previo.
 * Soporta números puros (1 -> 2), números con ceros a la izquierda (01 -> 02),
 * formatos con letras al final (19 D -> 20 D, 3 I -> 4 I), guiones (A-1 -> A-2, E12 -> E13),
 * e incrementa siempre el último bloque numérico encontrado.
 * Si el espacio no contiene números (ej: "General"), retorna cadena vacía.
 *
 * @param {string} spaceVal
 * @returns {string}
 */
export function getNextSpace(spaceVal) {
  if (!spaceVal || typeof spaceVal !== 'string') return '';
  const str = spaceVal.trim();
  const matches = [...str.matchAll(/\d+/g)];
  if (matches.length === 0) return '';

  const lastMatch = matches[matches.length - 1];
  const numStr = lastMatch[0];
  const index = lastMatch.index;
  const prefix = str.slice(0, index);
  const suffix = str.slice(index + numStr.length);

  const nextNum = parseInt(numStr, 10) + 1;
  const padded = nextNum.toString().padStart(numStr.length, '0');

  return prefix + padded + suffix;
}

/**
 * Ajusta numéricamente el espacio sumando o restando (delta: +1 o -1).
 * Control tipo Stepper para subir/bajar el espacio rápidamente.
 */
export function adjustNumericSpace(spaceVal, delta = 1) {
  if (!spaceVal || typeof spaceVal !== 'string') {
    return delta >= 0 ? '1' : '1';
  }
  const str = spaceVal.trim();
  const matches = [...str.matchAll(/\d+/g)];
  if (matches.length === 0) {
    return delta >= 0 ? '1' : '1';
  }

  const lastMatch = matches[matches.length - 1];
  const numStr = lastMatch[0];
  const index = lastMatch.index;
  const prefix = str.slice(0, index);
  const suffix = str.slice(index + numStr.length);

  const currentNum = parseInt(numStr, 10);
  const nextNum = Math.max(1, currentNum + delta);
  const padded = nextNum.toString().padStart(numStr.length, '0');

  return prefix + padded + suffix;
}

/**
 * Ajusta numéricamente la fila sumando o restando (delta: +1 o -1).
 * Soporta formatos como "Fila 1", "Fila 2", "1", "20", o letras simples ("A", "B").
 */
export function adjustNumericRow(rowVal, delta = 1) {
  if (!rowVal || typeof rowVal !== 'string') {
    return delta >= 0 ? 'Fila 1' : 'Fila 1';
  }
  const str = rowVal.trim();
  const matches = [...str.matchAll(/\d+/g)];
  if (matches.length === 0) {
    if (/^[A-Za-z]$/.test(str)) {
      const code = str.toUpperCase().charCodeAt(0);
      const nextCode = Math.max(65, Math.min(90, code + delta));
      return String.fromCharCode(nextCode);
    }
    return delta >= 0 ? 'Fila 1' : 'Fila 1';
  }

  const lastMatch = matches[matches.length - 1];
  const numStr = lastMatch[0];
  const index = lastMatch.index;
  const prefix = str.slice(0, index);
  const suffix = str.slice(index + numStr.length);

  const currentNum = parseInt(numStr, 10);
  const nextNum = Math.max(1, currentNum + delta);
  const padded = nextNum.toString().padStart(numStr.length, '0');

  return prefix + padded + suffix;
}
