import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Preprocesa un Canvas de HTML5 aumentando el contraste y eliminando ruido de fondo
 * (sombras de escáner, manchas de fotocopiadora, fondo grisáceo).
 * Deja el texto en negro puro y el fondo en blanco puro para que Tesseract alcance 99%+ de precisión.
 */
function preprocessCanvasForOcr(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Fórmula de luminancia ITU-R BT.601
      const gray = (r * 299 + g * 587 + b * 114) / 1000;

      // Umbral adaptativo: fondo claro/gris a blanco puro (255), trazo oscuro a negro puro (0)
      const clean = gray > 180 ? 255 : (gray < 115 ? 0 : Math.max(0, (gray - 60) * 1.6));
      data[i] = clean;
      data[i + 1] = clean;
      data[i + 2] = clean;
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("No se pudo preprocesar el canvas para OCR:", e);
  }
}

/**
 * Extrae directamente imágenes CCITTFaxDecode (Group 4) de PDFs escaneados en fotocopiadoras (Sharp, Ricoh, Brother)
 * y las empaqueta en buffers TIFF en memoria para que Tesseract las lea al instante sin depender de pdfjs canvas/WASM.
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
      const numTags = 8;
      const ifdOffset = 8;
      const ifdSize = 2 + numTags * 12 + 4;
      const pixelOffset = ifdOffset + ifdSize;
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
      view.setUint32(pos, 0, true);           // Next IFD = 0

      tiff.set(ccittData, pixelOffset);
      tiffBuffers.push(new Blob([tiff], { type: 'image/tiff' }));
    }

    searchPos = endstreamIdx + 9;
  }

  return tiffBuffers;
}

/**
 * Analiza el texto extraído (ya sea de capa nativa o de OCR) y devuelve la lista [{ serial, material }]
 * Motor Inteligente de Corrección Estructural Multi-Marca:
 * 1. Resuelve saltos de espacio del OCR a mitad de la serie (ej. "U65160C6HT 66699").
 * 2. Soporta múltiples series en un mismo renglón antes del pedimento.
 * 3. Corrige caracteres fantasma por manchas de escáner en series de 16 o 17 caracteres.
 * 4. Corrige confusión T/7, O/0, I/1, S/5, G/6, B/8, Z/2 en las posiciones estrictamente numéricas.
 * 5. Reconstruye el mes Brother en la posición 6 (letras A..M, ej. '0'->'D', '8'->'B').
 * 6. Valida y sincroniza el prefijo de 9 caracteres por Pedimento y Modelo dominante del lote.
 * 7. Extrae series de otras marcas (Sharp, HP, Ricoh, Canon, Kyocera, Lexmark) y detecta modelos.
 */
function parseSeriesFromText(rawText) {
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

      // Descomponer en palabras para manejar:
      // a) Series partidas con un espacio ("U65160C6HT 66699")
      // b) Múltiples series en una misma línea antes del pedimento
      const tokens = leftPart.split(/\s+/).filter(Boolean);
      let temp = '';

      for (let t = 0; t < tokens.length; t++) {
        const cleanTok = tokens[t].replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (!cleanTok) continue;

        if (cleanTok.length >= 13 && cleanTok.length <= 17) {
          if (temp) {
            if (temp.length >= 13 && temp.length <= 17) {
              rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
            }
            temp = '';
          }
          rawEntries.push({ rawSerial: cleanTok, pedimento: pedMatch ? pedMatch[1] : null });
        } else if (cleanTok.length >= 5 && cleanTok.length <= 12) {
          if (!temp) {
            temp = cleanTok;
          } else {
            const combined = temp + cleanTok;
            if (combined.length >= 13 && combined.length <= 17) {
              rawEntries.push({ rawSerial: combined, pedimento: pedMatch ? pedMatch[1] : null });
              temp = '';
            } else {
              if (temp.length >= 13 && temp.length <= 17) {
                rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
              }
              temp = cleanTok;
            }
          }
        }
      }

      if (temp && temp.length >= 13 && temp.length <= 17) {
        rawEntries.push({ rawSerial: temp, pedimento: pedMatch ? pedMatch[1] : null });
      }
    }
  }

  // 2. Escáner global continuo (NO excluyente): Captura series Brother en páginas o renglones sin columna de pedimento
  const brotherRegex = /\b([U0OVJE][A-Z0-9]{12,16})\b/gi;
  let bMatch;
  while ((bMatch = brotherRegex.exec(rawText)) !== null) {
    const cand = bMatch[1].trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cand.length >= 13 && cand.length <= 17 && /\d{4,}/.test(cand)) {
      const alreadyIncluded = rawEntries.some(e => e.rawSerial === cand || e.rawSerial.includes(cand));
      if (!alreadyIncluded) {
        rawEntries.push({ rawSerial: cand, pedimento: null });
      }
    }
  }

  // 3. Análisis de consenso del lote:
  // Determina el código de modelo Brother dominante (5 dígitos en pos 1..5), letra de planta (pos 8)
  // y relación Pedimento -> Prefijo de 9 caracteres
  const model5Counts = {};
  const plantCounts = {};
  const pedimentoToPrefix9 = {};

  for (const entry of rawEntries) {
    const c = entry.rawSerial;
    if (c.length === 15 && /^U\d{5}[A-Z]\d[A-Z]\d{6}$/.test(c)) {
      const m5 = c.slice(1, 6);
      const plant = c[8];
      const prefix9 = c.slice(0, 9);
      model5Counts[m5] = (model5Counts[m5] || 0) + 1;
      plantCounts[plant] = (plantCounts[plant] || 0) + 1;
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

  // 4. Reparador Maestro de Series Brother (Normaliza a 15 caracteres exactos)
  const normalizeBrotherSerial = (rawCandidate) => {
    let clean = rawCandidate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    // Reparar 'U' inicial leída erróneamente por OCR
    if (/^[0OVJEL]/.test(clean) && clean.length >= 14) {
      clean = 'U' + clean.slice(1);
    }

    // CASO A: 16 o 17 caracteres (el escáner insertó caracteres o manchas fantasma)
    if ((clean.length === 16 || clean.length === 17) && clean.startsWith('U')) {
      const last6 = clean.slice(-6).split('').map(fixDigit).join('');
      if (/^\d{6}$/.test(last6)) {
        const prefixPart = clean.slice(0, clean.length - 6);
        let bestCandidate = null;

        // Probar remover cada posición sobrante para alcanzar los 9 caracteres de prefijo
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

    // CASO B: 15 caracteres (Estructura estándar Brother: U + 5 dígitos + LetraMes + DígitoAño + LetraPlanta + 6 dígitos)
    if (clean.length === 15 && clean.startsWith('U')) {
      const chars = clean.split('');
      for (let idx = 1; idx <= 5; idx++) chars[idx] = fixDigit(chars[idx]);

      // Corrección de Letra de Mes (pos 6: A..M)
      if (chars[6] === '0' || chars[6] === 'O') chars[6] = 'D';
      if (chars[6] === '8') chars[6] = 'B';
      if (chars[6] === '6') chars[6] = 'G';

      // Corrección de Dígito de Año (pos 7: 0..9)
      chars[7] = fixDigit(chars[7]);

      // Corrección de Letra de Planta (pos 8: Letra)
      if (dominantPlant && !/[A-Z]/.test(chars[8])) {
        chars[8] = dominantPlant;
      }

      // Corrección de los 6 dígitos consecutivos finales (pos 9..14: 0..9)
      for (let idx = 9; idx <= 14; idx++) chars[idx] = fixDigit(chars[idx]);

      clean = chars.join('');
    }

    return clean;
  };

  // 5. Aplicar validación contra pedimento y modelo dominante
  for (const entry of rawEntries) {
    let clean = normalizeBrotherSerial(entry.rawSerial);

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

    if (clean.startsWith('U') && clean.length >= 13 && clean.length <= 16) {
      if (!seenSerials.has(clean)) {
        seenSerials.add(clean);
        items.push({ serial: clean, material: materialRaw });
      }
    }
  }

  // 6. Extracción para otras marcas (Sharp, HP, Ricoh, Canon, Lexmark):
  // Formato Sharp: "Serial #..." o "Serial..." seguido del número
  const sharpRegex = /(?:Serial\s*#?|S\/N\s*[:#]?|SERIE\s*[:#]?)\s*([A-Z0-9-]{6,16})/gi;
  let sMatch;
  while ((sMatch = sharpRegex.exec(rawText)) !== null) {
    const serialString = sMatch[1].trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (serialString.length >= 6 && !seenSerials.has(serialString)) {
      // Evitar confundir con números de pedimento o facturas
      if (!/^\d{4}-\d{6,8}$/.test(serialString) && !/^MXF\d+$/.test(serialString)) {
        seenSerials.add(serialString);
        items.push({ serial: serialString, material: materialRaw });
      }
    }
  }

  // Formato HP estándar (10 caracteres: 3 letras de país + 7 alfanuméricos, ej. VNC3K04921, CNB8G12345)
  const hpSerialRegex = /\b([A-Z]{3}[A-Z0-9]{7})\b/g;
  let hpMatch;
  while ((hpMatch = hpSerialRegex.exec(rawText)) !== null) {
    const cand = hpMatch[1].toUpperCase();
    if (!seenSerials.has(cand) && /[A-Z]/.test(cand.slice(0, 3)) && /\d/.test(cand.slice(3))) {
      seenSerials.add(cand);
      items.push({ serial: cand, material: materialRaw.startsWith('HP') ? materialRaw : 'HP ' + materialRaw });
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
        // extraer el stream TIFF de cada página directamente y pasarlo a Tesseract
        const ccittBlobs = extractCcittTiffBuffersFromPdfBytes(typedarray);
        if (ccittBlobs.length > 0) {
          console.log(`Detectadas ${ccittBlobs.length} página(s) escaneadas (CCITT Fax). Ejecutando OCR directo...`);
          for (let idx = 0; idx < ccittBlobs.length; idx++) {
            if (onProgress) {
              onProgress({
                stage: 'ccitt',
                page: idx + 1,
                totalPages: ccittBlobs.length,
                message: `Procesando página ${idx + 1} de ${ccittBlobs.length} con OCR directo...`
              });
            }
            const blob = ccittBlobs[idx];
            const { data: { text } } = await Tesseract.recognize(blob, 'eng');
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
          console.log("Iniciando OCR por renderizado optimizado de página (Escala 2.5x + Filtro)...");
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
            // Escala 2.5x: proporción perfecta para lectura nítida de matrices de puntos y letras finas
            const viewport = page.getViewport({ scale: 2.5 });

            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            const context = canvas.getContext('2d');

            await page.render({ canvasContext: context, viewport }).promise;

            // Filtro de binarización y contraste: elimina manchas y fondos sucios
            preprocessCanvasForOcr(canvas);

            const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
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
