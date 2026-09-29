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
        let headerRowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (Array.isArray(row)) {
            serialIndex = row.findIndex(cell => 
              typeof cell === 'string' && cell.trim().toLowerCase() === 'serial number'
            );
            
            if (serialIndex !== -1) {
              headerRowIndex = i;
              break;
            }
          }
        }

        if (serialIndex === -1) {
          throw new Error('No se encontró la columna llamada "Serial Number" en el documento Excel.');
        }

        const series = [];
        
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          const serie = row[serialIndex];
          
          if (serie !== undefined && serie !== null && String(serie).trim() !== '') {
            series.push(String(serie).trim().toUpperCase());
          }
        }

        const uniqueSeries = [...new Set(series)];
        
        resolve(uniqueSeries);
      } catch (error) {
        console.error("Error procesando Excel:", error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => reject(error);
    
    reader.readAsArrayBuffer(file);
  });
}
