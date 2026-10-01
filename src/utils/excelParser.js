import * as XLSX from 'xlsx';

export async function extractSeriesFromExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        let serialIndex = -1;
        let materialIndex = -1;
        let headerRowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (Array.isArray(row)) {
            const tempSerialIndex = row.findIndex(cell => 
              typeof cell === 'string' && cell.trim().toLowerCase() === 'serial number'
            );
            
            const tempMaterialIndex = row.findIndex(cell => 
              typeof cell === 'string' && cell.trim().toLowerCase() === 'material'
            );
            
            if (tempSerialIndex !== -1) {
              serialIndex = tempSerialIndex;
              materialIndex = tempMaterialIndex !== -1 ? tempMaterialIndex : -1;
              headerRowIndex = i;
              break;
            }
          }
        }

        if (serialIndex === -1) {
          throw new Error('No se encontró la columna llamada "Serial Number" en el documento Excel.');
        }

        const items = [];
        const seenSerials = new Set();
        
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          const serieRaw = row[serialIndex];
          const materialRaw = materialIndex !== -1 ? row[materialIndex] : 'DESCONOCIDO';
          
          if (serieRaw !== undefined && serieRaw !== null && String(serieRaw).trim() !== '') {
            const serialString = String(serieRaw).trim().toUpperCase();
            
            if (!seenSerials.has(serialString)) {
              seenSerials.add(serialString);
              items.push({
                serial: serialString,
                material: String(materialRaw).trim().toUpperCase()
              });
            }
          }
        }

        resolve(items);
      } catch (error) {
        console.error("Error procesando Excel:", error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => reject(error);
    
    reader.readAsArrayBuffer(file);
  });
}
