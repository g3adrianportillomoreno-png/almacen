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
 */
function parseSeriesFromText(rawText) {
  const items = [];
  const seenSerials = new Set();

  // Buscar el Modelo de Impresora:
  // Priorizar modelos Brother (MFC..., HL..., DCP...) o Sharp (MX-..., BP-...) evitando confundir con Factura "MXF0374378"
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

  const fixDigit = (ch) => {
    const map = { 'O': '0', 'Q': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6' };
    return map[ch] || ch;
  };

  const normalizeBrotherCandidate = (candidate) => {
    let clean = candidate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (/^[0OVJ][0-9A-Z]{13,15}$/.test(clean)) {
      clean = 'U' + clean.slice(1);
    }
    if (clean.length === 15 && clean.startsWith('U')) {
      const chars = clean.split('');
      for (let idx = 1; idx <= 5; idx++) chars[idx] = fixDigit(chars[idx]);
      chars[7] = fixDigit(chars[7]);
      for (let idx = 9; idx <= 14; idx++) chars[idx] = fixDigit(chars[idx]);
      clean = chars.join('');
    }
    return clean;
  };

  const rawBrotherCandidates = [];

  // 1. Formato "Anexo de Series y Pedimentos" (Serie al inicio de línea acompañada de pedimento 3904-6007834 o fecha 202X-XX-XX)
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    if (/\b\d{4}-\d{6,8}\b/.test(line) || /\b202\d-\d{2}-\d{2}\b/.test(line)) {
      const tokens = line.trim().split(/\s+/);
      for (const token of tokens) {
        const cleanedToken = token.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
        if (/^\d{4}-\d{6,8}$/.test(cleanedToken) || /^202\d-\d{2}-\d{2}$/.test(cleanedToken)) continue;
        const alphaNum = cleanedToken.replace(/-/g, '');
        if (alphaNum.length >= 13 && alphaNum.length <= 17 && /[A-Z]/.test(alphaNum) && /\d{4,}/.test(alphaNum)) {
          rawBrotherCandidates.push(alphaNum);
        }
      }
    }
  }

  // 2. Expresión regular general para series Brother en cualquier documento
  const brotherRegex = /\b([U0OVJ][A-Z0-9]{12,15})\b/gi;
  let match;
  while ((match = brotherRegex.exec(rawText)) !== null) {
    const cand = match[1].trim().toUpperCase();
    if (/[A-Z]/i.test(cand.slice(1)) && /\d{4,}/.test(cand)) {
      rawBrotherCandidates.push(cand);
    }
  }

  // 3. Respaldo por si un número escrito a mano se pegó antes de la 'U' (ej: 15U67672F6N214922)
  const brotherFallbackRegex = /(U[A-Z0-9]{13,15})/gi;
  while ((match = brotherFallbackRegex.exec(rawText)) !== null) {
    const cand = match[1].trim().toUpperCase();
    if (/\d{4,}/.test(cand)) {
      rawBrotherCandidates.push(cand);
    }
  }

  // Determinar el prefijo de lote dominante de 9 caracteres (ej. U67672F6N) para reparar errores puntuales de OCR
  // como U6T7672F6N214939 (16 chars por una T infiltrada) o U67672r6N214913 ('r' en vez de 'F')
  const normalizedPreList = rawBrotherCandidates.map(normalizeBrotherCandidate);
  const prefixCounts = {};
  for (const c of normalizedPreList) {
    if (c.length === 15 && c.startsWith('U')) {
      const p = c.slice(0, 9);
      prefixCounts[p] = (prefixCounts[p] || 0) + 1;
    }
  }
  let dominantPrefix = null;
  let maxCount = 0;
  for (const [p, count] of Object.entries(prefixCounts)) {
    if (count > maxCount && count >= 3) {
      maxCount = count;
      dominantPrefix = p;
    }
  }

  for (let clean of normalizedPreList) {
    if (dominantPrefix) {
      const last6 = clean.slice(-6).split('').map(fixDigit).join('');
      if (clean.length === 16 && /^\d{6}$/.test(last6)) {
        clean = dominantPrefix + last6;
      } else if (clean.length === 15 && /^\d{6}$/.test(last6)) {
        let diffs = 0;
        for (let i = 0; i < 9; i++) {
          if (clean[i] !== dominantPrefix[i]) diffs++;
        }
        if (diffs <= 2) {
          clean = dominantPrefix + last6;
        }
      }
    }

    if (clean.startsWith('U') && clean.length >= 13 && clean.length <= 16) {
      if (!seenSerials.has(clean)) {
        seenSerials.add(clean);
        items.push({ serial: clean, material: materialRaw });
      }
    }
  }

  // 4. Series Sharp (Dice "Serial #..." o "Serial..." seguido del número)
  const sharpRegex = /Serial\s*#?\s*([A-Z0-9]{6,15})/gi;
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
        // extraer el stream TIFF directamente y pasarlo a Tesseract (mucho más rápido y no falla en navegadores sin soporte CCITT en pdf.js)
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
