import * as XLSX from 'xlsx';

/**
 * Normaliza nombres de encabezado eliminando acentos, caracteres especiales y espacios redundantes
 */
function normalizeHeader(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return '';
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^a-z0-9]/g, ' ')      // símbolos a espacios
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Limpia el contenido de una celda de guía o rastreo
 */
function cleanValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Quitar comillas envolventes si vienen en CSVs
  str = str.replace(/^["']+|["']+$/g, '').trim();
  return str;
}

/**
 * Extrae Número de Guía y Número de Rastreo de un archivo Excel o CSV
 * Cumple estrictamente con recibir únicamente estas dos columnas
 * 
 * @param {File} file Archivo seleccionado (.xlsx, .xls, .csv)
 * @returns {Promise<{ items: Array<{ guideNumber: string, trackingNumber: string }>, fileName: string, total: number }>}
 */
export async function extractMercadoLibreData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('El archivo no contiene hojas válidas.');
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Leer como matriz de celdas
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (!rows || rows.length === 0) {
          throw new Error('El archivo Excel está completamente vacío.');
        }

        let guideColIdx = -1;
        let trackingColIdx = -1;
        let headerRowIndex = -1;

        // 1. Intentar localizar encabezados buscando en las primeras 15 filas
        for (let r = 0; r < Math.min(rows.length, 15); r++) {
          const row = rows[r];
          if (!Array.isArray(row)) continue;

          let foundGuide = -1;
          let foundTracking = -1;

          row.forEach((cell, colIdx) => {
            const norm = normalizeHeader(cell);
            if (!norm) return;

            // Variaciones para NÚMERO DE GUÍA
            const isGuide = 
              norm === 'numero de guia' ||
              norm === 'num de guia' ||
              norm === 'no de guia' ||
              norm === 'no guia' ||
              norm === 'numero guia' ||
              norm === 'num guia' ||
              norm === 'guia' ||
              norm === 'guias' ||
              norm === 'guide' ||
              norm === 'shipping guide' ||
              norm.includes('guia') ||
              norm.includes('guide');

            // Variaciones para NÚMERO DE RASTREO
            const isTracking = 
              norm === 'numero de rastreo' ||
              norm === 'num de rastreo' ||
              norm === 'no de rastreo' ||
              norm === 'no rastreo' ||
              norm === 'numero rastreo' ||
              norm === 'num rastreo' ||
              norm === 'rastreo' ||
              norm === 'tracking' ||
              norm === 'tracking number' ||
              norm === 'codigo de rastreo' ||
              norm === 'codigo rastreo' ||
              norm.includes('rastreo') ||
              norm.includes('tracking');

            if (isGuide && foundGuide === -1) {
              foundGuide = colIdx;
            } else if (isTracking && foundTracking === -1) {
              foundTracking = colIdx;
            }
          });

          if (foundGuide !== -1 && foundTracking !== -1) {
            guideColIdx = foundGuide;
            trackingColIdx = foundTracking;
            headerRowIndex = r;
            break;
          }
        }

        // 2. Si no se encontraron por nombre explícito pero la hoja tiene exactamente 2 columnas
        if (guideColIdx === -1 || trackingColIdx === -1) {
          // Evaluar la primera fila que contenga al menos 2 celdas no vacías
          for (let r = 0; r < Math.min(rows.length, 10); r++) {
            const row = rows[r];
            if (Array.isArray(row)) {
              const nonEmp = row.map((c, idx) => ({ c: cleanValue(c), idx })).filter(item => item.c !== '');
              if (nonEmp.length === 2) {
                // Verificar si la fila parece encabezado
                const norm0 = normalizeHeader(nonEmp[0].c);
                const norm1 = normalizeHeader(nonEmp[1].c);
                const isHeaderLike = norm0.includes('guia') || norm0.includes('rastreo') || norm1.includes('guia') || norm1.includes('rastreo');
                
                headerRowIndex = r;
                guideColIdx = nonEmp[0].idx;
                trackingColIdx = nonEmp[1].idx;
                if (!isHeaderLike) {
                  // Si no es encabezado, procesar desde esta misma fila
                  headerRowIndex = r - 1;
                }
                break;
              }
            }
          }
        }

        // Si aún no se encuentran dos columnas
        if (guideColIdx === -1 || trackingColIdx === -1) {
          throw new Error(
            "No se pudieron identificar las dos columnas obligatorias. " +
            "Asegúrate de que el archivo tenga las columnas 'Número de guía' y 'Número de rastreo'."
          );
        }

        // 3. Extraer los datos a partir de la fila siguiente al encabezado
        const items = [];
        const seenKeys = new Set();
        const startRow = headerRowIndex + 1;

        for (let r = startRow; r < rows.length; r++) {
          const row = rows[r];
          if (!Array.isArray(row)) continue;

          const guideVal = cleanValue(row[guideColIdx]);
          const trackingVal = cleanValue(row[trackingColIdx]);

          // Si ambas celdas están vacías, ignorar
          if (!guideVal && !trackingVal) continue;

          // Si alguna tiene valor, registrar
          if (guideVal || trackingVal) {
            // Clave única para evitar duplicados exactos dentro del mismo archivo
            const uniqueKey = `${guideVal.toUpperCase()}###${trackingVal.toUpperCase()}`;
            if (!seenKeys.has(uniqueKey)) {
              seenKeys.add(uniqueKey);
              items.push({
                guideNumber: guideVal || trackingVal, // Fallback si alguna viene vacía
                trackingNumber: trackingVal || guideVal
              });
            }
          }
        }

        if (items.length === 0) {
          throw new Error('El archivo no contiene filas con datos válidos de guía y rastreo.');
        }

        resolve({
          items,
          fileName: file.name,
          total: items.length
        });
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('No se pudo leer el archivo. Intenta de nuevo.'));
    };

    reader.readAsArrayBuffer(file);
  });
}
