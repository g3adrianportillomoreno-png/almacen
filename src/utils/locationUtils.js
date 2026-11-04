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
