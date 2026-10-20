import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function extractSeriesFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const numPages = pdf.numPages;
        
        let fullText = "";

        // INTENTO 1: Extraer la capa de texto nativa del PDF
        for (let i = 1; i <= numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(" ");
          fullText += pageText + " \n";
        }

        // Función auxiliar para normalizar y extraer series del texto obtenido
        const parseSeriesFromText = (rawText) => {
          const items = [];
          const seenSerials = new Set();

          // Buscar el Modelo (Ej: MFCL8970CDW, MFC..., HL..., DCP... para Brother, MX-... para Sharp)
          // Limpiamos posibles errores de OCR en el prefijo del modelo (ej. MFCL, MFC-, HL-, DCP-, MX-)
          const modelMatch = rawText.match(/\b(MFC-?[A-Z0-9]{3,12}|HL-?[A-Z0-9]{3,12}|DCP-?[A-Z0-9]{3,12}|MX-?[A-Z0-9]{3,12})\b/i);
          let materialRaw = 'DESCONOCIDO';
          if (modelMatch) {
            materialRaw = modelMatch[0].toUpperCase();
            // En documentos "Anexo de Series y Pedimentos" de Brother (ej. MFCL8970CDW), el OCR a veces confunde la 'L' o '8' en el modelo (ej. MFC18970CDW -> MFCL8970CDW)
            if (/^MFC1\d{4}/.test(materialRaw)) {
              materialRaw = 'MFCL' + materialRaw.slice(4);
            }
          }

          /**
           * Función para corregir confusiones típicas de OCR en números de serie Brother (15 caracteres: p.ej. U67672F6N214922)
           * En documentos escaneados con fuente tipo consola (Anexo de Series y Pedimentos):
           * - La 'U' inicial a veces es leída por el OCR como '0', 'O', 'V', 'Ü', 'J' o 'I' seguida de dígitos (ej. 67672, 66655, etc.)
           * - Dentro de la parte numérica el OCR puede confundir 'O' -> '0', 'I'/'l' -> '1', 'S' -> '5', 'B' -> '8', 'Z' -> '2'
           */
          const normalizeBrotherCandidate = (candidate) => {
            let clean = candidate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            // Si empieza con 0, O o V seguido de 6 (ej. 067672F6N214922 -> U67672F6N214922)
            if (/^[0OVJ][0-9]{4,5}[A-Z0-9]{8,10}$/.test(clean)) {
              clean = 'U' + clean.slice(1);
            }
            // Si tiene estructura U + 5 dígitos + Letra + Dígito + Letra + 6 dígitos (formato estándar Brother 15 chars)
            // Corregir posibles letras infiltradas en las posiciones que siempre son numéricas
            if (clean.length === 15 && clean.startsWith('U')) {
              const fixDigit = (ch) => {
                const map = { 'O': '0', 'Q': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6' };
                return map[ch] || ch;
              };
              const chars = clean.split('');
              // Posiciones 1..5 suelen ser dígitos (ej. 67672)
              for (let idx = 1; idx <= 5; idx++) chars[idx] = fixDigit(chars[idx]);
              // Posición 7 suele ser dígito (ej. 6 en F6N)
              chars[7] = fixDigit(chars[7]);
              // Posiciones 9..14 (últimos 6 caracteres) son el consecutivo numérico de la serie (ej. 214922)
              for (let idx = 9; idx <= 14; idx++) chars[idx] = fixDigit(chars[idx]);
              clean = chars.join('');
            }
            return clean;
          };

          // REGLA 1A: Series Brother estándar o con el primer carácter mal leído por OCR (U, 0, O, V seguido de 4-5 dígitos y alfanuméricos, total 13 a 15 chars)
          const brotherExtendedRegex = /\b([U0OVJ][0-9OIZSBG]{4,5}[A-Z0-9]{8,10})\b/gi;
          let match;
          while ((match = brotherExtendedRegex.exec(rawText)) !== null) {
            const rawCandidate = match[1].trim().toUpperCase();
            // Evitar falsos positivos que sean puros números de pedimento o teléfonos sin letras intermedias
            if (!/[A-Z]/i.test(rawCandidate.slice(1))) continue;

            const normalized = normalizeBrotherCandidate(rawCandidate);
            if (normalized.startsWith('U') && normalized.length >= 13 && normalized.length <= 16) {
              if (!seenSerials.has(normalized)) {
                seenSerials.add(normalized);
                items.push({ serial: normalized, material: materialRaw });
              }
            }
          }

          // REGLA 1B: Respaldo sin \b inicial por si el OCR pegó un número de lista a la U (ej: 1U67672F6N214922)
          const brotherFallbackRegex = /(U[A-Z0-9]{13,15})/gi;
          while ((match = brotherFallbackRegex.exec(rawText)) !== null) {
            const rawCandidate = match[1].trim().toUpperCase();
            if (!/[0-9]/.test(rawCandidate)) continue; // Debe contener números
            const normalized = normalizeBrotherCandidate(rawCandidate);
            if (!seenSerials.has(normalized)) {
              seenSerials.add(normalized);
              items.push({ serial: normalized, material: materialRaw });
            }
          }

          // REGLA 2: Sharp (Dice "Serial #..." o "Serial..." seguido del número)
          const sharpRegex = /Serial\s*#?\s*([A-Z0-9]{6,15})/gi;
          while ((match = sharpRegex.exec(rawText)) !== null) {
            const serialString = match[1].trim().toUpperCase();
            if (!seenSerials.has(serialString)) {
              seenSerials.add(serialString);
              items.push({ serial: serialString, material: materialRaw });
            }
          }

          // REGLA 3: Formato "Anexo de Series y Pedimentos" (cuando viene Serie de 12-16 caracteres alfanuméricos seguida en la misma línea de un pedimento tipo 3904-6007834 o fecha 202X-XX-XX)
          const lines = rawText.split(/\r?\n/);
          for (const line of lines) {
            // Busca en líneas que tengan un pedimento (4 dígitos - 7 dígitos) o fecha (202X-XX-XX)
            if (/\b\d{4}-\d{6,8}\b/.test(line) || /\b202\d-\d{2}-\d{2}\b/.test(line)) {
              const tokens = line.trim().split(/\s+/);
              for (const token of tokens) {
                const cleanedToken = token.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
                // Ignorar el propio pedimento, fechas o cantidades cortas
                if (/^\d{4}-\d{6,8}$/.test(cleanedToken) || /^202\d-\d{2}-\d{2}$/.test(cleanedToken)) continue;
                const alphaNum = cleanedToken.replace(/-/g, '');
                if (alphaNum.length >= 13 && alphaNum.length <= 16 && /[A-Z]/.test(alphaNum) && /\d{4,}/.test(alphaNum)) {
                  const normalized = normalizeBrotherCandidate(alphaNum);
                  if (!seenSerials.has(normalized)) {
                    seenSerials.add(normalized);
                    items.push({ serial: normalized, material: materialRaw });
                  }
                }
              }
            }
          }

          return items;
        };

        // Intentar primero con el texto nativo del PDF
        let extractedItems = parseSeriesFromText(fullText);

        // Si el texto nativo está vacío O si no se encontró ninguna serie (ej. PDF escaneado que solo tenía un encabezado de texto o marca de agua), ejecutar OCR de alta resolución con pre-procesado de contraste
        if (fullText.trim().length < 100 || extractedItems.length === 0) {
          console.log("Iniciando reconocimiento óptico (OCR) mejorado para PDF escaneado...");
          let ocrText = "";
          
          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            // Escala 2.5 para mayor nitidez en fuentes pequeñas o matriciales ("Anexo de Series y Pedimentos")
            const viewport = page.getViewport({ scale: 2.5 });
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Fondo blanco explícito y renderizado
            context.fillStyle = '#FFFFFF';
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // Mejorar contraste (binarización suave) para limpiar manchas grises de escáner y resaltar las letras
            const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            for (let p = 0; p < data.length; p += 4) {
              const avg = (data[p] * 0.299) + (data[p + 1] * 0.587) + (data[p + 2] * 0.114);
              // Umbral para volver el texto más negro y el fondo completamente blanco
              const val = avg < 185 ? Math.max(0, avg * 0.5) : 255;
              data[p] = val;
              data[p + 1] = val;
              data[p + 2] = val;
            }
            context.putImageData(imgData, 0, 0);

            const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
            ocrText += text + " \n";
          }

          console.log("Texto extraído por OCR:", ocrText);
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
