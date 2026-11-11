import * as XLSX from 'xlsx';
import { PrinterModel } from '../models/PrinterModel.js';

function normalizeHeader(str) {
  if (typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^a-z0-9]/g, ' ')      // símbolos a espacios
    .trim()
    .replace(/\s+/g, ' ');
}

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
        let internalNumberIndex = -1;
        let warehouseIndex = -1;
        let rowIndex = -1;
        let spaceIndex = -1;
        let statusIndex = -1;
        let headerRowIndex = -1;

        // Buscar encabezados reconociendo múltiples variaciones (CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO, ALMACEN, FILA, ESPACIO, ESTADO, etc.)
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const row = rows[i];
          if (Array.isArray(row)) {
            let foundSerial = -1;
            let foundMaterial = -1;
            let foundInternal = -1;
            let foundWarehouse = -1;
            let foundRow = -1;
            let foundSpace = -1;
            let foundStatus = -1;

            row.forEach((cell, colIdx) => {
              const norm = normalizeHeader(cell);
              if (!norm) return;

              // 1. NÚMERO DE SERIE
              if (
                norm === 'numero de serie' || 
                norm === 'no de serie' || 
                norm === 'num de serie' ||
                norm === 'serial number' || 
                norm === 'serie' || 
                norm === 'serial' ||
                norm === 'sn' ||
                norm.includes('serie') ||
                norm.includes('serial')
              ) {
                foundSerial = colIdx;
              }

              // 2. CLAVE / MODELO
              else if (
                norm === 'clave' ||
                norm === 'modelo' ||
                norm === 'material' ||
                norm === 'clave modelo' ||
                norm.includes('clave') ||
                norm.includes('modelo') ||
                norm.includes('material')
              ) {
                foundMaterial = colIdx;
              }

              // 3. NÚMERO DE EQUIPO / SANTI / ECONÓMICO
              else if (
                norm === 'santi' ||
                norm === 'no santi' ||
                norm === 'no. santi' ||
                norm === 'numero santi' ||
                norm === 'num santi' ||
                norm === 'id santi' ||
                norm === 'economico' ||
                norm === 'no economico' ||
                norm === 'no. economico' ||
                norm === 'numero de equipo' || 
                norm === 'no de equipo' || 
                norm === 'no equipo' || 
                norm === 'num de equipo' || 
                norm === 'numero equipo' || 
                norm === 'equipo' || 
                norm.includes('santi') ||
                norm.includes('equipo') || 
                norm.includes('internal number') ||
                norm.includes('economico')
              ) {
                foundInternal = colIdx;
              }

              // 4. ESTADO (SISTEMA / PROCESO: Seminuevos, Refacciones, Remanufacturado, Principal)
              // Evaluamos Estado antes de Almacén para evitar que "ESTADO ALMACEN" se tome como bodega física
              else if (
                norm === 'estado' || 
                norm === 'status' || 
                norm === 'estatus' || 
                norm === 'area' || 
                norm === 'proceso' || 
                norm === 'etapa' ||
                norm.includes('estado') || 
                norm.includes('status') || 
                norm.includes('estatus') ||
                norm.includes('proceso')
              ) {
                foundStatus = colIdx;
              }

              // 5. ALMACÉN FÍSICO (Almacén 1, Almacén 2, Bodega, etc.)
              else if (
                norm === 'almacen' || 
                norm === 'almacenes' || 
                norm === 'bodega' ||
                norm === 'bodegas' ||
                norm.includes('almacen') ||
                norm.includes('bodega')
              ) {
                foundWarehouse = colIdx;
              }

              // 6. FILA
              else if (
                norm === 'fila' || 
                norm === 'filas' || 
                norm.includes('fila')
              ) {
                foundRow = colIdx;
              }

              // 7. ESPACIO
              else if (
                norm === 'espacio' || 
                norm === 'espacios' || 
                norm === 'posicion' || 
                norm.includes('espacio')
              ) {
                foundSpace = colIdx;
              }
            });

            if (foundSerial !== -1) {
              serialIndex = foundSerial;
              materialIndex = foundMaterial;
              internalNumberIndex = foundInternal;
              warehouseIndex = foundWarehouse;
              rowIndex = foundRow;
              spaceIndex = foundSpace;
              statusIndex = foundStatus;
              headerRowIndex = i;
              break;
            }
          }
        }

        if (serialIndex === -1) {
          throw new Error('No se encontró la columna de serie en el Excel. Debe llamarse "NUMERO DE SERIE", "SERIE" o "SERIAL NUMBER".');
        }

        const items = [];
        const seenSerials = new Set();

        for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !Array.isArray(row)) continue;

          const serieRaw = row[serialIndex];
          const hasMaterialCol = materialIndex !== -1;
          const materialRaw = (hasMaterialCol && row[materialIndex] !== undefined && row[materialIndex] !== null && String(row[materialIndex]).trim() !== '')
            ? String(row[materialIndex]).trim().toUpperCase()
            : null;

          const internalNumRaw = internalNumberIndex !== -1 ? row[internalNumberIndex] : null;
          const warehouseRaw = warehouseIndex !== -1 ? row[warehouseIndex] : null;
          const rowRaw = rowIndex !== -1 ? row[rowIndex] : null;
          const spaceRaw = spaceIndex !== -1 ? row[spaceIndex] : null;
          const statusRaw = statusIndex !== -1 ? row[statusIndex] : null;
          
          if (serieRaw !== undefined && serieRaw !== null && String(serieRaw).trim() !== '') {
            const serialString = String(serieRaw).trim().toUpperCase();
            
            if (!seenSerials.has(serialString)) {
              seenSerials.add(serialString);

              const internalNumberFormatted = internalNumRaw !== undefined && internalNumRaw !== null && String(internalNumRaw).trim() !== ''
                ? String(internalNumRaw).trim()
                : null;

              const cleanWh = warehouseRaw && String(warehouseRaw).trim() !== '' ? String(warehouseRaw).trim() : null;
              const systemStatus = (statusRaw && String(statusRaw).trim() !== '') ? PrinterModel.normalizeSystemStatus(statusRaw) : null;

              items.push({
                serial: serialString,
                material: materialRaw, // null si la columna de modelo no vino en el Excel
                internalNumber: internalNumberFormatted,
                warehouseName: cleanWh,
                warehouseRow: rowRaw && String(rowRaw).trim() !== '' ? String(rowRaw).trim() : null,
                warehouseSpace: spaceRaw !== null && spaceRaw !== undefined && String(spaceRaw).trim() !== '' ? String(spaceRaw).trim() : null,
                systemStatus: systemStatus
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
