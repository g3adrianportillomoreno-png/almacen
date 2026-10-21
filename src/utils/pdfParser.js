import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Preprocesa un Canvas de HTML5 aumentando el contraste, eliminando ruido de fondo
 * (sombras de escáner, manchas de fotocopiadora, fondo grisáceo) y aplicando cierre morfológico
 * para reconectar trazos finos cortados en dígitos escaneados por fax (ej. 6->3, 9->2, 8->3).
 */
function preprocessCanvasForOcr(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Paso 1: Binarización adaptativa y limpieza de fondo grisáceo
    const grayBuf = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Fórmula de luminancia ITU-R BT.601
      const gray = (r * 299 + g * 587 + b * 114) / 1000;

      // Umbral adaptativo: fondo claro/gris a blanco puro (255), trazo oscuro a negro puro (0)
      const clean = gray > 185 ? 255 : (gray < 128 ? 0 : Math.max(0, Math.min(255, Math.round((gray - 65) * 1.7))));
      grayBuf[p] = clean;
      data[i] = clean;
      data[i + 1] = clean;
      data[i + 2] = clean;
    }

    // Paso 2: Cierre morfológico direccional (horizontal, vertical y diagonal de 1px)
    // Reconecta las curvas de dígitos como '6', '9', '8', '5', '0' cuando el escáner fax corta 1 píxel
    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = rowOffset + x;
        if (grayBuf[idx] > 128) {
          const left = grayBuf[idx - 1] < 80;
          const right = grayBuf[idx + 1] < 80;
          const top = grayBuf[idx - width] < 80;
          const bottom = grayBuf[idx + width] < 80;
          const diag1 = grayBuf[idx - width - 1] < 80 && grayBuf[idx + width + 1] < 80;
          const diag2 = grayBuf[idx - width + 1] < 80 && grayBuf[idx + width - 1] < 80;

          if ((left && right) || (top && bottom) || diag1 || diag2) {
            const rgbaIdx = idx * 4;
            data[rgbaIdx] = 0;
            data[rgbaIdx + 1] = 0;
            data[rgbaIdx + 2] = 0;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("No se pudo preprocesar el canvas para OCR:", e);
  }
}

/**
 * Extrae directamente imágenes CCITTFaxDecode (Group 4) de PDFs escaneados en fotocopiadoras (Sharp, Ricoh, Brother)
 * y las empaqueta en buffers TIFF en memoria con metadatos de resolución 300 DPI para que Tesseract/Leptonica
 * escale los trazos finos de forma óptima sin depender de pdfjs canvas/WASM.
 */
function extractCcittTiffBuffersFromPdfBytes(uint8Array) {
  const tiffBuffers = [];
  let rawStr = '';
  const CHUNK = 32768;
  for (let i = 0; i < uint8Array.length; i += CHUNK) {
    rawStr += String.fromCharCode.apply(null, uint8Array.subarray(i, i + CHUNK));
  }

  let searchPos = 0;
  while (true) {
    const ccittIdx = rawStr.indexOf('/CCITTFaxDecode', searchPos);
    if (ccittIdx === -1) break;

    const objStart = Math.max(0, ccittIdx - 350);
    const streamKeywordIdx = rawStr.indexOf('stream', ccittIdx);
    const endstreamIdx = rawStr.indexOf('endstream', streamKeywordIdx);

    if (streamKeywordIdx === -1 || endstreamIdx === -1) {
      searchPos = ccittIdx + 15;
      continue;
    }

    const headerPart = rawStr.slice(objStart, streamKeywordIdx);
    const widthMatch = headerPart.match(/\/(?:Width|Columns)\s+(\d+)/);
    const heightMatch = headerPart.match(/\/(?:Height|Rows)\s+(\d+)/);

    const width = widthMatch ? parseInt(widthMatch[1], 10) : 1696;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : 2192;

    let dataStart = streamKeywordIdx + 6;
    if (uint8Array[dataStart] === 0x0D && uint8Array[dataStart + 1] === 0x0A) {
      dataStart += 2;
    } else if (uint8Array[dataStart] === 0x0A || uint8Array[dataStart] === 0x0D) {
      dataStart += 1;
    }

    let dataEnd = endstreamIdx;
    while (
      dataEnd > dataStart &&
      (uint8Array[dataEnd - 1] === 0x0A || uint8Array[dataEnd - 1] === 0x0D || uint8Array[dataEnd - 1] === 0x20)
    ) {
      dataEnd--;
    }

    const ccittData = uint8Array.subarray(dataStart, dataEnd);
    if (ccittData.length > 100) {
      const numTags = 11;
      const ifdOffset = 8;
      const ifdSize = 2 + numTags * 12 + 4;
      const resOffset = ifdOffset + ifdSize; // 16 bytes para XResolution y YResolution (300/1 DPI)
      const pixelOffset = resOffset + 16;
      const tiff = new Uint8Array(pixelOffset + ccittData.length);
      const view = new DataView(tiff.buffer);

      // Cabecera TIFF Little Endian ('II', 42, IFD offset 8)
      tiff[0] = 0x49;
      tiff[1] = 0x49;
      view.setUint16(2, 42, true);
      view.setUint32(4, ifdOffset, true);

      let pos = ifdOffset;
      view.setUint16(pos, numTags, true);
      pos += 2;

      const writeTag = (tag, type, count, val) => {
        view.setUint16(pos, tag, true);
        view.setUint16(pos + 2, type, true);
        view.setUint32(pos + 4, count, true);
        view.setUint32(pos + 8, val, true);
        pos += 12;
      };

      writeTag(256, 4, 1, width);             // ImageWidth
      writeTag(257, 4, 1, height);            // ImageLength
      writeTag(258, 3, 1, 1);                 // BitsPerSample = 1
      writeTag(259, 3, 1, 4);                 // Compression = 4 (CCITT Group 4)
      writeTag(262, 3, 1, 0);                 // PhotometricInterpretation = 0 (WhiteIsZero)
      writeTag(273, 4, 1, pixelOffset);       // StripOffsets
      writeTag(278, 4, 1, height);            // RowsPerStrip
      writeTag(279, 4, 1, ccittData.length);  // StripByteCounts
      writeTag(282, 5, 1, resOffset);         // XResolution (300 DPI)
      writeTag(283, 5, 1, resOffset + 8);     // YResolution (300 DPI)
      writeTag(296, 3, 1, 2);                 // ResolutionUnit = 2 (Inch)
      view.setUint32(pos, 0, true);           // Next IFD = 0

      // Escribir RATIONAL 300/1 para XResolution y YResolution
      view.setUint32(resOffset, 300, true);
      view.setUint32(resOffset + 4, 1, true);
      view.setUint32(resOffset + 8, 300, true);
      view.setUint32(resOffset + 12, 1, true);

      tiff.set(ccittData, pixelOffset);
      tiffBuffers.push(new Blob([tiff], { type: 'image/tiff' }));
    }

    searchPos = endstreamIdx + 9;
  }

  return tiffBuffers;
}

/**
 * Analiza el texto extraído (ya sea de capa nativa o de OCR) y devuelve la lista [{ serial, material, repairedFrom }]
 * Motor Inteligente de Corrección Estructural y Consenso Estadístico de Lote:
 * 1. Resuelve saltos de espacio del OCR a mitad de la serie (ej. "U65160C6HT 66699").
 * 2. Soporta múltiples series en un mismo renglón antes del pedimento.
 * 3. Corrige caracteres fantasma por manchas de escáner en series de 16 o 17 caracteres,
 *    distinguiendo si el carácter fantasma está en el prefijo (pos 0..8) o en el sufijo numérico (pos 9..15, ej. U66653F6N6492812 -> U66653F6N649812).
 * 4. Corrige confusión T/7, O/0, I/1, S/5, G/6, B/8, Z/2 en las posiciones estrictamente numéricas.
 * 5. Reconstruye el mes Brother en la posición 6 (letras A..M, ej. '0'->'D', '8'->'B').
 * 6. Repara dígitos de secuencia aislados por rotura de trazo en fax (ej. 350226 -> 650226, 642806 -> 649806)
 *    mediante análisis de clústeres de sub-prefijos (3 y 4 dígitos) y proximidad de vecinos en el lote.
 */
export function parseSeriesFromText(rawText) {
  const items = [];
  const seenSerials = new Set();

  // Detección del Modelo de Impresora en el Documento:
  const brotherModelMatch = rawText.match(/\b(MFC-?[A-Z0-9]{3,12}|HL-?[A-Z0-9]{3,12}|DCP-?[A-Z0-9]{3,12})\b/i);
  const sharpModelMatch = rawText.match(/\b(MX-(?!F\d)[A-Z0-9-]{3,12}|BP-[A-Z0-9-]{3,12}|DX-[A-Z0-9-]{3,12})\b/i);
  const hpModelMatch = rawText.match(/\b(?:LaserJet|PageWide|DesignJet)\s+(?:Pro\s+)?([A-Z0-9-]{3,12})\b/i);
  const ricohModelMatch = rawText.match(/\b(MP\s*\d{3,4}[A-Z]*|IM\s*\d{3,4}[A-Z]*|Aficio\s+[A-Z0-9]+)\b/i);
  const canonModelMatch = rawText.match(/\b(imageRUNNER\s+[A-Z0-9-]+|iR-ADV\s+[A-Z0-9-]+)\b/i);
  const kyoceraModelMatch = rawText.match(/\b(ECOSYS\s+[A-Z0-9-]+|TASKalfa\s+[A-Z0-9-]+)\b/i);

  let materialRaw = 'MODELO GENERAL';

  if (brotherModelMatch) {
    materialRaw = brotherModelMatch[0].toUpperCase();
    if (/^MFC1\d{4}/.test(materialRaw)) {
      materialRaw = 'MFCL' + materialRaw.slice(4);
    }
  } else if (sharpModelMatch) {
    materialRaw = sharpModelMatch[0].toUpperCase();
  } else if (hpModelMatch) {
    materialRaw = 'HP ' + hpModelMatch[0].toUpperCase();
  } else if (ricohModelMatch) {
    materialRaw = 'RICOH ' + ricohModelMatch[0].toUpperCase().replace(/\s+/g, ' ');
  } else if (canonModelMatch) {
    materialRaw = canonModelMatch[0].toUpperCase();
  } else if (kyoceraModelMatch) {
    materialRaw = kyoceraModelMatch[0].toUpperCase();
  }

  // Mapa exhaustivo de caracteres OCR leídos como letras/símbolos en posiciones que DEBEN ser números
  const fixDigit = (ch) => {
    if (!ch) return '0';
    const upper = String(ch).toUpperCase();
    const map = {
      'O': '0', 'Q': '0', 'D': '0', 'U': '0',
      'I': '1', 'L': '1', '|': '1', '!': '1', '/': '1', ']': '1', '[': '1', 'J': '1',
      'Z': '2',
      'E': '3',
      'A': '4',
      'S': '5',
      'G': '6', 'b': '6',
      'T': '7', 'Y': '7', '?': '7', '\\': '7',
      'B': '8', '&': '8',
      'g': '9', 'q': '9', 'P': '9'
    };
    return map[upper] || (/\d/.test(upper) ? upper : upper);
  };

  const rawEntries = []; // { rawSerial, pedimento }
  const lines = rawText.split(/\r?\n/);

  // 1. Extraer candidatos línea por línea considerando columnas de pedimento o fecha
  for (const line of lines) {
    const pedMatch = line.match(/\b(\d{4}-\d{6,8})\b/);
    const hasDate = /\b202\d-\d{2}-\d{2}\b/.test(line);

    if (pedMatch || hasDate) {
      const cutIdx = pedMatch ? line.indexOf(pedMatch[1]) : line.search(/\b202\d-\d{2}-\d{2}\b/);
      const leftPart = (cutIdx > 0 ? line.slice(0, cutIdx) : line).trim();

      const tokens = leftPart.split(/\s+/).filter(Boolean);
      let temp = '';

      for (let t = 0; t < tokens.length; t++) {
        const cleanTok = tokens[t].replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (!cleanTok) continue;
        // Ignorar palabras de encabezado o modelos que aparezcan antes de una fecha/pedimento
        if (/^(MFC|HL|DCP|MXF|BMX|PAGINA|ANEXO|CLIENTE|FACTURA|EMBARQUE|FECHA|TOTAL|COLOR|LASER|INKJET)/i.test(cleanTok)) {
          continue;
        }

        if (cleanTok.length >= 13 && cleanTok.length <= 17) {
          if (temp) {
            if (temp.length >= 13 && temp.length <= 17) {
              rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
            }
            temp = '';
          }
          rawEntries.push({ rawSerial: cleanTok, pedimento: pedMatch ? pedMatch[1] : null });
        } else if (cleanTok.length >= 4 && cleanTok.length <= 12) {
          if (!temp) {
            if (/^[U0OVJ]\d{2,}/i.test(cleanTok)) {
              temp = cleanTok;
            }
          } else {
            const combined = temp + cleanTok;
            if (combined.length >= 13 && combined.length <= 17) {
              rawEntries.push({ rawSerial: combined, pedimento: pedMatch ? pedMatch[1] : null });
              temp = '';
            } else {
              if (temp.length >= 13 && temp.length <= 17) {
                rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
              }
              temp = /^[U0OVJ]\d{2,}/i.test(cleanTok) ? cleanTok : '';
            }
          }
        }
      }

      if (temp && temp.length >= 13 && temp.length <= 17) {
        rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
      }
    }
  }

  // 2. Solo si el documento NO tenía columnas de pedimento/fecha, buscar series que empiecen con U en el texto general
  if (rawEntries.length === 0) {
    const brotherRegex = /\b(U\d{4,5}[A-Z0-9]{8,10})\b/gi;
    let bMatch;
    while ((bMatch = brotherRegex.exec(rawText)) !== null) {
      const cand = bMatch[1].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cand.length >= 13 && cand.length <= 16) {
        rawEntries.push({ rawSerial: cand, pedimento: null });
      }
    }
  }

  // 3. Análisis de consenso del lote:
  const model5Counts = {};
  const plantCounts = {};
  const pedimentoToPrefix9 = {};
  const seq3Counts = {};
  const seq4Counts = {};
  const validSeq6Set = new Set();

  for (const entry of rawEntries) {
    const c = entry.rawSerial;
    if (c.length === 15 && /^U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(c)) {
      const m5 = c.slice(1, 6);
      const plant = c[8];
      const prefix9 = c.slice(0, 9);
      const seq6 = c.slice(9, 15);
      const s3 = seq6.slice(0, 3);
      const s4 = seq6.slice(0, 4);

      model5Counts[m5] = (model5Counts[m5] || 0) + 1;
      plantCounts[plant] = (plantCounts[plant] || 0) + 1;
      seq3Counts[s3] = (seq3Counts[s3] || 0) + 1;
      seq4Counts[s4] = (seq4Counts[s4] || 0) + 1;
      validSeq6Set.add(seq6);

      if (entry.pedimento) {
        pedimentoToPrefix9[entry.pedimento] = prefix9;
      }
    }
  }

  let dominantModel5 = null;
  let maxM5 = 0;
  for (const [m5, cnt] of Object.entries(model5Counts)) {
    if (cnt > maxM5 && cnt >= 2) {
      maxM5 = cnt;
      dominantModel5 = m5;
    }
  }

  let dominantPlant = null;
  let maxPlant = 0;
  for (const [pl, cnt] of Object.entries(plantCounts)) {
    if (cnt > maxPlant && cnt >= 2) {
      maxPlant = cnt;
      dominantPlant = pl;
    }
  }

  const validSeq6Nums = Array.from(validSeq6Set).map((s) => parseInt(s, 10));

  // 4. Reparador Maestro de Series Brother (Normaliza a 15 caracteres exactos)
  const normalizeBrotherSerial = (rawCandidate) => {
    let clean = rawCandidate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    // Reparar 'U' inicial solo cuando el OCR leyó '0', 'O', 'V' o 'J' seguido de los 4-5 dígitos del código de modelo Brother
    if (/^[0OVJ]\d{4,5}/.test(clean) && clean.length >= 14) {
      clean = 'U' + clean.slice(1);
    }

    // CASO A: 16 o 17 caracteres (el escáner insertó caracteres o manchas fantasma)
    if ((clean.length === 16 || clean.length === 17) && clean.startsWith('U')) {
      const pDigits9 = clean.slice(1, 6).split('').map(fixDigit).join('');
      let mChar9 = clean[6];
      if (mChar9 === '0' || mChar9 === 'O') mChar9 = 'D';
      if (mChar9 === '8') mChar9 = 'B';
      if (mChar9 === '6') mChar9 = 'G';
      const yDigit9 = fixDigit(clean[7]);
      let plChar9 = clean[8];
      if (dominantPlant && !/[A-Z]/.test(plChar9)) {
        plChar9 = dominantPlant;
      }

      const isPrefix9Valid =
        /^\d{5}$/.test(pDigits9) &&
        /[A-Z]/.test(mChar9) &&
        /^\d$/.test(yDigit9) &&
        /[A-Z]/.test(plChar9) &&
        (!dominantModel5 || pDigits9 === dominantModel5);

      const suffixRaw = clean.slice(9).split('').map(fixDigit).join('');

      if (isPrefix9Valid && /^\d{7,8}$/.test(suffixRaw)) {
        const validPrefix9 = 'U' + pDigits9 + mChar9 + yDigit9 + plChar9;
        let bestSuffix6 = null;
        let bestScore = -Infinity;

        const testSuffix6 = (cand6) => {
          if (cand6.length !== 6 || !/^\d{6}$/.test(cand6)) return;
          const s4 = cand6.slice(0, 4);
          const s3 = cand6.slice(0, 3);
          let score = (seq4Counts[s4] || 0) * 100 + (seq3Counts[s3] || 0) * 20;
          const cNum = parseInt(cand6, 10);
          let minDist = Infinity;
          for (const n of validSeq6Nums) {
            const d = Math.abs(cNum - n);
            if (d > 0 && d < minDist) minDist = d;
          }
          if (minDist <= 25) score += 60 - minDist;
          if (validSeq6Set.has(cand6)) score -= 80;
          if (score > bestScore) {
            bestScore = score;
            bestSuffix6 = cand6;
          }
        };

        if (suffixRaw.length === 7) {
          for (let rm = 0; rm < 7; rm++) {
            testSuffix6(suffixRaw.slice(0, rm) + suffixRaw.slice(rm + 1));
          }
        } else if (suffixRaw.length === 8) {
          for (let rm1 = 0; rm1 < 8; rm1++) {
            for (let rm2 = rm1 + 1; rm2 < 8; rm2++) {
              testSuffix6(suffixRaw.slice(0, rm1) + suffixRaw.slice(rm1 + 1, rm2) + suffixRaw.slice(rm2 + 1));
            }
          }
        }

        if (bestSuffix6) {
          clean = validPrefix9 + bestSuffix6;
        }
      } else {
        const last6 = clean.slice(-6).split('').map(fixDigit).join('');
        if (/^\d{6}$/.test(last6)) {
          const prefixPart = clean.slice(0, clean.length - 6);
          let bestCandidate = null;

          for (let removeIdx = prefixPart.length - 1; removeIdx >= 1; removeIdx--) {
            const candidate9 = prefixPart.slice(0, removeIdx) + prefixPart.slice(removeIdx + 1);
            if (candidate9.length !== 9) continue;

            const pDigits = candidate9.slice(1, 6).split('').map(fixDigit).join('');
            let monthChar = candidate9[6];
            if (monthChar === '0' || monthChar === 'O') monthChar = 'D';
            if (monthChar === '8') monthChar = 'B';
            if (monthChar === '6') monthChar = 'G';

            const yearDigit = fixDigit(candidate9[7]);
            let plantChar = candidate9[8];
            if (dominantPlant && !/[A-Z]/.test(plantChar)) {
              plantChar = dominantPlant;
            }

            if (/^\d{5}$/.test(pDigits) && /[A-Z]/.test(monthChar) && /^\d$/.test(yearDigit) && /[A-Z]/.test(plantChar)) {
              const built = 'U' + pDigits + monthChar + yearDigit + plantChar + last6;
              if (!bestCandidate) bestCandidate = built;
              if (dominantModel5 && pDigits === dominantModel5 && (!dominantPlant || plantChar === dominantPlant)) {
                bestCandidate = built;
                break;
              }
            }
          }

          if (bestCandidate) {
            clean = bestCandidate;
          }
        }
      }
    }

    // CASO B: 15 caracteres (Estructura estándar Brother: U + 5 dígitos + LetraMes + DígitoAño + LetraPlanta + 6 dígitos)
    if (clean.length === 15 && clean.startsWith('U')) {
      const chars = clean.split('');
      for (let idx = 1; idx <= 5; idx++) chars[idx] = fixDigit(chars[idx]);

      if (chars[6] === '0' || chars[6] === 'O') chars[6] = 'D';
      if (chars[6] === '8') chars[6] = 'B';
      if (chars[6] === '6') chars[6] = 'G';

      chars[7] = fixDigit(chars[7]);

      if (dominantPlant && !/[A-Z]/.test(chars[8])) {
        chars[8] = dominantPlant;
      }

      for (let idx = 9; idx <= 14; idx++) chars[idx] = fixDigit(chars[idx]);

      clean = chars.join('');
    }

    return clean;
  };

  // 5. Aplicar validación contra pedimento y modelo dominante
  for (const entry of rawEntries) {
    const rawOriginal = entry.rawSerial.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    let clean = normalizeBrotherSerial(rawOriginal);

    if (entry.pedimento && pedimentoToPrefix9[entry.pedimento] && clean.length === 15) {
      const expectedPrefix9 = pedimentoToPrefix9[entry.pedimento];
      let diffs = 0;
      for (let i = 0; i < 9; i++) {
        if (clean[i] !== expectedPrefix9[i]) diffs++;
      }
      if (diffs <= 2) {
        clean = expectedPrefix9 + clean.slice(9);
      }
    } else if (dominantModel5 && clean.length === 15) {
      let diffs = 0;
      for (let i = 0; i < 5; i++) {
        if (clean[i + 1] !== dominantModel5[i]) diffs++;
      }
      if (diffs === 1) {
        clean = 'U' + dominantModel5 + clean.slice(6);
      }
    }

    // Solo aceptar números de serie que empiecen estrictamente con 'U' y tengan estructura válida de serie
    if (
      clean.startsWith('U') &&
      clean.length >= 13 &&
      clean.length <= 16 &&
      /^U\d{4,5}[A-Z0-9]+$/.test(clean)
    ) {
      if (!seenSerials.has(clean)) {
        seenSerials.add(clean);
        items.push({
          serial: clean,
          material: materialRaw,
          repairedFrom: clean !== rawOriginal ? rawOriginal : null
        });
      }
    }
  }

  // 6. Reparación Estadística de Clústeres de Secuencia (Outliers en los primeros 3 y 4 dígitos del consecutivo)
  const byPrefix9 = {};
  for (let idx = 0; idx < items.length; idx++) {
    const s = items[idx].serial;
    if (s.length === 15 && /^U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(s)) {
      const p9 = s.slice(0, 9);
      if (!byPrefix9[p9]) byPrefix9[p9] = [];
      byPrefix9[p9].push(idx);
    }
  }

  for (const [p9, indices] of Object.entries(byPrefix9)) {
    if (indices.length < 4) continue;

    const groupSeq3Counts = {};
    const groupSeq4Counts = {};
    const groupNums = [];

    for (const i of indices) {
      const seq6 = items[i].serial.slice(9, 15);
      const s3 = seq6.slice(0, 3);
      const s4 = seq6.slice(0, 4);
      groupSeq3Counts[s3] = (groupSeq3Counts[s3] || 0) + 1;
      groupSeq4Counts[s4] = (groupSeq4Counts[s4] || 0) + 1;
      groupNums.push({ idx: i, num: parseInt(seq6, 10), seq6 });
    }

    const majorSeq3List = Object.entries(groupSeq3Counts)
      .filter(([, cnt]) => cnt >= 2)
      .map(([s3]) => s3);

    const majorSeq4List = Object.entries(groupSeq4Counts)
      .filter(([, cnt]) => cnt >= 2)
      .map(([s4]) => s4);

    if (majorSeq3List.length === 0 && majorSeq4List.length === 0) continue;

    for (const i of indices) {
      const currentSerial = items[i].serial;
      const seq6 = currentSerial.slice(9, 15);
      const s3 = seq6.slice(0, 3);
      const s4 = seq6.slice(0, 4);

      const isS3Outlier = groupSeq3Counts[s3] === 1;
      const isS4Outlier = groupSeq4Counts[s4] === 1;
      if (!isS3Outlier && !isS4Outlier) continue;

      const currentNum = parseInt(seq6, 10);
      let minDistSelf = Infinity;
      for (const gn of groupNums) {
        if (gn.idx === i) continue;
        const d = Math.abs(currentNum - gn.num);
        if (d < minDistSelf) minDistSelf = d;
      }

      // Solo reparar si está numéricamente aislado (> 80 de distancia a cualquier otro equipo del mismo prefijo)
      if (minDistSelf <= 80) continue;

      const candidateSeq6Set = new Set();

      if (isS3Outlier) {
        for (const majS3 of majorSeq3List) {
          let diffs = 0;
          for (let k = 0; k < 3; k++) {
            if (s3[k] !== majS3[k]) diffs++;
          }
          if (diffs === 1) {
            candidateSeq6Set.add(majS3 + seq6.slice(3));
          }

          if (majS3.slice(1) === s3.slice(0, 2)) {
            const expanded7 = majS3[0] + seq6;
            for (let rm = 2; rm < 7; rm++) {
              const rebuilt6 = expanded7.slice(0, rm) + expanded7.slice(rm + 1);
              if (rebuilt6.startsWith(majS3)) {
                candidateSeq6Set.add(rebuilt6);
              }
            }
          }
        }
      }

      if (isS4Outlier) {
        for (const majS4 of majorSeq4List) {
          let diffs = 0;
          for (let k = 0; k < 4; k++) {
            if (s4[k] !== majS4[k]) diffs++;
          }
          if (diffs === 1) {
            candidateSeq6Set.add(majS4 + seq6.slice(4));
          }
        }
      }

      let bestReplacementSerial = null;
      let bestMinDist = Infinity;

      for (const candSeq6 of candidateSeq6Set) {
        const candSerial = p9 + candSeq6;
        if (seenSerials.has(candSerial)) continue;

        const candNum = parseInt(candSeq6, 10);
        let minDist = Infinity;
        for (const gn of groupNums) {
          if (gn.idx === i) continue;
          const d = Math.abs(candNum - gn.num);
          if (d < minDist) minDist = d;
        }

        if (minDist <= 50 && minDist < bestMinDist) {
          bestMinDist = minDist;
          bestReplacementSerial = candSerial;
        }
      }

      if (bestReplacementSerial) {
        seenSerials.delete(currentSerial);
        seenSerials.add(bestReplacementSerial);
        if (!items[i].repairedFrom) {
          items[i].repairedFrom = currentSerial;
        }
        items[i].serial = bestReplacementSerial;
      }
    }
  }

  return items;
}

export async function extractSeriesFromPDF(file, onProgress = null) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target.result);
        let extractedItems = [];
        let combinedOcrText = "";

        // PASO 1: Si el PDF proviene de un escáner Sharp/copiadora con compresión CCITTFaxDecode,
        // extraer el stream TIFF de cada página con cabecera 300 DPI y pasarlo a Tesseract
        const ccittBlobs = extractCcittTiffBuffersFromPdfBytes(typedarray);
        if (ccittBlobs.length > 0) {
          console.log(`Detectadas ${ccittBlobs.length} página(s) escaneadas (CCITT Fax 300 DPI). Ejecutando OCR...`);
          for (let idx = 0; idx < ccittBlobs.length; idx++) {
            if (onProgress) {
              onProgress({
                stage: 'ccitt',
                page: idx + 1,
                totalPages: ccittBlobs.length,
                message: `Procesando página ${idx + 1} de ${ccittBlobs.length} con OCR de alta precisión...`
              });
            }
            const blob = ccittBlobs[idx];
            const { data: { text } } = await Tesseract.recognize(blob, 'eng', {
              preserve_interword_spaces: '1'
            });
            combinedOcrText += text + "\n";
          }
          extractedItems = parseSeriesFromText(combinedOcrText);
          if (extractedItems.length > 0) {
            resolve(extractedItems);
            return;
          }
        }

        // PASO 2: Extraer capa de texto nativa con pdf.js
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const numPages = pdf.numPages;
        let fullText = "";

        for (let i = 1; i <= numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(" ");
          fullText += pageText + " \n";
        }

        extractedItems = parseSeriesFromText(fullText);

        // PASO 3: Si no hubo series o fue escaso en la capa de texto, renderizar páginas en Canvas optimizado + Filtro y OCR
        if (fullText.trim().length < 100 || extractedItems.length === 0) {
          console.log("Iniciando OCR por renderizado optimizado de página (Escala 2.5x + Filtro Morfológico)...");
          let canvasOcrText = "";

          for (let i = 1; i <= numPages; i++) {
            if (onProgress) {
              onProgress({
                stage: 'canvas',
                page: i,
                totalPages: numPages,
                message: `Analizando con OCR optimizado página ${i} de ${numPages}...`
              });
            }

            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.5 });

            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            const context = canvas.getContext('2d');

            await page.render({ canvasContext: context, viewport }).promise;

            preprocessCanvasForOcr(canvas);

            const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
              preserve_interword_spaces: '1'
            });
            canvasOcrText += text + " \n";
          }

          const ocrItems = parseSeriesFromText(fullText + "\n" + combinedOcrText + "\n" + canvasOcrText);
          if (ocrItems.length > 0) {
            extractedItems = ocrItems;
          }
        }

        resolve(extractedItems);
      } catch (error) {
        console.error("Error procesando PDF con OCR:", error);
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}
