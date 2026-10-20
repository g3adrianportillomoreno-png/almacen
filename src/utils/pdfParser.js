import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

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
 * Incluye corrección estructural inteligente para los documentos "Anexo de Series y Pedimentos":
 * 1. Une series que el OCR haya partido con un espacio a mitad del renglón (ej. "U65160C6HT 66699").
 * 2. Elimina letras fantasma insertadas por manchas de escáner en series de 16 caracteres (ej. "U65160C6HT766809" -> "U65160C6H766809").
 * 3. Corrige el '7' leído como 'T' en el consecutivo numérico (ej. "U65160C6HT66731" -> "U65160C6H766731").
 * 4. Valida el prefijo de 9 caracteres contra el pedimento de la misma línea y el código de modelo de 5 dígitos del documento.
 */
function parseSeriesFromText(rawText) {
  const items = [];
  const seenSerials = new Set();

  // Buscar el Modelo de Impresora:
  // Priorizar modelos Brother (MFC..., HL..., DCP...) o Sharp (MX-..., BP-...) evitando confundir con Factura "MXF0374377"
  const brotherModelMatch = rawText.match(/\b(MFC-?[A-Z0-9]{3,12}|HL-?[A-Z0-9]{3,12}|DCP-?[A-Z0-9]{3,12})\b/i);
  const sharpModelMatch = rawText.match(/\b(MX-(?!F\d)[A-Z0-9-]{3,12}|BP-[A-Z0-9-]{3,12})\b/i);
  let materialRaw = 'DESCONOCIDO';

  if (brotherModelMatch) {
    materialRaw = brotherModelMatch[0].toUpperCase();
    if (/^MFC1\d{4}/.test(materialRaw)) {
      materialRaw = 'MFCL' + materialRaw.slice(4);
    }
  } else if (sharpModelMatch) {
    materialRaw = sharpModelMatch[0].toUpperCase();
  }

  // Mapa extendido para reparar caracteres que en una posición 100% numérica fueron leídos como letra por el OCR
  const fixDigit = (ch) => {
    const map = {
      'O': '0', 'Q': '0', 'D': '0',
      'I': '1', 'L': '1',
      'Z': '2',
      'S': '5',
      'G': '6',
      'T': '7', 'Y': '7', 'J': '7', '?': '7',
      'B': '8'
    };
    return map[ch] || ch;
  };

  // Extraer candidatos línea por línea (soportando cuando el OCR parte la serie con un espacio, ej. "U65160C6HT 66699 3904-6004465")
  const rawEntries = []; // { rawSerial, pedimento }
  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    const pedMatch = line.match(/\b(\d{4}-\d{6,8})\b/);
    const hasDate = /\b202\d-\d{2}-\d{2}\b/.test(line);

    if (pedMatch || hasDate) {
      const cutIdx = pedMatch ? line.indexOf(pedMatch[1]) : line.search(/\b202\d-\d{2}-\d{2}\b/);
      const leftPart = (cutIdx > 0 ? line.slice(0, cutIdx) : line).trim();
      const compactLeft = leftPart.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (compactLeft.length >= 13 && compactLeft.length <= 17 && /[A-Z]/i.test(compactLeft) && /\d{4,}/.test(compactLeft)) {
        rawEntries.push({
          rawSerial: compactLeft,
          pedimento: pedMatch ? pedMatch[1] : null
        });
      }
    }
  }

  // Si no era un documento con columnas de pedimento/fecha, buscar con expresiones regulares generales
  if (rawEntries.length === 0) {
    const brotherRegex = /\b([U0OVJ][A-Z0-9]{12,15})\b/gi;
    let match;
    while ((match = brotherRegex.exec(rawText)) !== null) {
      const cand = match[1].trim().toUpperCase();
      if (/[A-Z]/i.test(cand.slice(1)) && /\d{4,}/.test(cand)) {
        rawEntries.push({ rawSerial: cand, pedimento: null });
      }
    }

    const brotherFallbackRegex = /(U[A-Z0-9]{13,15})/gi;
    while ((match = brotherFallbackRegex.exec(rawText)) !== null) {
      const cand = match[1].trim().toUpperCase();
      if (/\d{4,}/.test(cand)) {
        rawEntries.push({ rawSerial: cand, pedimento: null });
      }
    }
  }

  // Analizar el código de modelo de 5 dígitos (pos 1..5), letra de planta (pos 8) y relación Pedimento -> Prefijo de 9 chars
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

  // Función que repara un candidato Brother a sus 15 caracteres exactos
  const normalizeBrotherSerial = (rawCandidate) => {
    let clean = rawCandidate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    if (/^[0OVJ]/.test(clean) && clean.length >= 14) {
      clean = 'U' + clean.slice(1);
    }

    // Caso 1: 16 caracteres (el OCR insertó una letra fantasma, ej. U65160C6HT766809, U65160D6EH106775, U6T7672F6N214939)
    if (clean.length === 16 && clean.startsWith('U')) {
      const last6 = clean.slice(-6).split('').map(fixDigit).join('');
      if (/^\d{6}$/.test(last6)) {
        const prefix10 = clean.slice(0, 10);
        let bestCandidate = null;
        for (const removeIdx of [9, 8, 7, 6, 2, 3, 4, 5, 1]) {
          const candidate9 = prefix10.slice(0, removeIdx) + prefix10.slice(removeIdx + 1);
          const pDigits = candidate9.slice(1, 6).split('').map(fixDigit).join('');
          const monthChar = candidate9[6];
          const yearDigit = fixDigit(candidate9[7]);
          const plantChar = candidate9[8];
          if (/^\d{5}$/.test(pDigits) && /[A-Z]/.test(monthChar) && /^\d$/.test(yearDigit) && /[A-Z]/.test(plantChar)) {
            const built = 'U' + pDigits + monthChar + yearDigit + plantChar + last6;
            if (!bestCandidate) bestCandidate = built;
            // Si además coincide con el código de modelo de 5 dígitos dominante del documento, elegirlo de inmediato
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

    // Caso 2: 15 caracteres (estructura estándar Brother: U + 5 dígitos + LetraMes + DígitoAño + LetraPlanta + 6 dígitos)
    if (clean.length === 15 && clean.startsWith('U')) {
      const chars = clean.split('');
      for (let idx = 1; idx <= 5; idx++) chars[idx] = fixDigit(chars[idx]);
      if (chars[6] === '0') chars[6] = 'D';
      if (chars[6] === '8') chars[6] = 'B';
      chars[7] = fixDigit(chars[7]);
      if (dominantPlant && !/[A-Z]/.test(chars[8])) {
        chars[8] = dominantPlant;
      }
      for (let idx = 9; idx <= 14; idx++) chars[idx] = fixDigit(chars[idx]);
      clean = chars.join('');
    }

    return clean;
  };

  for (const entry of rawEntries) {
    let clean = normalizeBrotherSerial(entry.rawSerial);

    // Validar prefijo de 9 caracteres contra el pedimento de la misma línea (ej. 3904-6004465 -> U65160C6H)
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

  // Series Sharp (Dice "Serial #..." o "Serial..." seguido del número)
  const sharpRegex = /Serial\s*#?\s*([A-Z0-9]{6,15})/gi;
  let match;
  while ((match = sharpRegex.exec(rawText)) !== null) {
    const serialString = match[1].trim().toUpperCase();
    if (!seenSerials.has(serialString)) {
      seenSerials.add(serialString);
      items.push({ serial: serialString, material: materialRaw });
    }
  }

  return items;
}

export async function extractSeriesFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target.result);

        // PASO 1: Si el PDF proviene de un escáner Sharp/copiadora con compresión CCITTFaxDecode,
        // extraer el stream TIFF de cada página directamente y pasarlo a Tesseract
        const ccittBlobs = extractCcittTiffBuffersFromPdfBytes(typedarray);
        if (ccittBlobs.length > 0) {
          console.log(`Detectadas ${ccittBlobs.length} página(s) escaneadas (CCITT Fax). Ejecutando OCR directo...`);
          let ccittText = "";
          for (const blob of ccittBlobs) {
            const { data: { text } } = await Tesseract.recognize(blob, 'eng');
            ccittText += text + "\n";
          }
          const ccittItems = parseSeriesFromText(ccittText);
          if (ccittItems.length > 0) {
            resolve(ccittItems);
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

        let extractedItems = parseSeriesFromText(fullText);

        // PASO 3: Si no hubo series en la capa de texto, renderizar cada página en canvas y pasar por Tesseract
        if (fullText.trim().length < 100 || extractedItems.length === 0) {
          console.log("Iniciando OCR por renderizado de página...");
          let ocrText = "";

          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport }).promise;
            const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
            ocrText += text + " \n";
          }

          const ocrItems = parseSeriesFromText(fullText + "\n" + ocrText);
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
