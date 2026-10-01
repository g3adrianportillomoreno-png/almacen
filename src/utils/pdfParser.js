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
          fullText += pageText + " ";
        }

        // Si el texto extraído es muy corto, significa que el PDF es una imagen escaneada (sin texto seleccionable)
        if (fullText.trim().length < 100) {
          console.log("El PDF parece ser un escaneo (sin texto nativo). Iniciando reconocimiento óptico (OCR)... esto puede tardar un poco.");
          fullText = ""; // Resetear
          
          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Escala 2.0 para mejor resolución en OCR
            
            // Crear un canvas temporal para renderizar la página del PDF
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // Pasar el canvas por Tesseract.js para extraer el texto de la imagen
            const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
            fullText += text + " \n";
          }
        }

        console.log("Texto completo extraído:", fullText);

        // Buscar el Modelo (Ej: MFC..., HL..., DCP... para Brother, MX-... para Sharp)
        const modelMatch = fullText.match(/\b(MFC-?[A-Z0-9]+|HL-?[A-Z0-9]+|DCP-?[A-Z0-9]+|MX-?[A-Z0-9]+)\b/i);
        const materialRaw = modelMatch ? modelMatch[0] : 'DESCONOCIDO'; 

        const items = [];
        const seenSerials = new Set();

        // REGLA 1: Brother (Empieza con U seguido de caracteres alfanuméricos)
        // Quitamos el \b porque a veces el OCR pega los números escritos a mano a la serie (ej: 75U66655F...)
        // Y permitimos entre 13 y 15 caracteres por si el OCR omitió una letra borrosa.
        const brotherRegex = /(U[A-Z0-9]{13,15})/gi;
        let match;
        while ((match = brotherRegex.exec(fullText)) !== null) {
          const serialString = match[1].trim().toUpperCase();
          if (!seenSerials.has(serialString)) {
            seenSerials.add(serialString);
            items.push({ serial: serialString, material: materialRaw.toUpperCase() });
          }
        }

        // REGLA 2: Sharp (Dice "Serial #..." o "Serial..." seguido del número)
        // Quitamos el \b final también por si el OCR pegó algún paréntesis u otro símbolo
        const sharpRegex = /Serial\s*#?\s*([A-Z0-9]{6,15})/gi;
        while ((match = sharpRegex.exec(fullText)) !== null) {
          const serialString = match[1].trim().toUpperCase();
          if (!seenSerials.has(serialString)) {
            seenSerials.add(serialString);
            items.push({ serial: serialString, material: materialRaw.toUpperCase() });
          }
        }

        resolve(items);
      } catch (error) {
        console.error("Error procesando PDF con OCR:", error);
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}
