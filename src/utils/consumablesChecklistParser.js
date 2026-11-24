// src/utils/consumablesChecklistParser.js
import * as XLSX from 'xlsx';
import defaultConsumibles from './consumiblesDefaultData.json' with { type: 'json' };

/**
 * Normaliza una celda o texto quitando acentos y espacios extra
 */
function cleanText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeHeader(str) {
  return cleanText(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Busca la ubicación física predeterminada en el catálogo de consumibles maestro
 */
export function findConsumableLocation(code, barcode, catalog = defaultConsumibles) {
  if (!Array.isArray(catalog) || catalog.length === 0) return 'Sin Asignar';
  
  const cClean = String(code || '').trim().toUpperCase();
  const bClean = String(barcode || '').trim();

  const found = catalog.find(item => {
    const itemClave = String(item.clave || '').trim().toUpperCase();
    if (cClean && itemClave === cClean) return true;
    if (bClean && Array.isArray(item.barcodes) && item.barcodes.includes(bClean)) return true;
    return false;
  });

  if (!found) return 'Sin Asignar';

  const parts = [];
  if (found.seccion) parts.push(found.seccion);
  if (found.anaquel) parts.push(`Anaquel: ${found.anaquel}`);
  if (found.espacio) parts.push(`Espacio: ${found.espacio}`);
  if (found.almacen && found.almacen !== 'Principal') parts.push(`(${found.almacen})`);

  return parts.length > 0 ? parts.join(' - ') : (found.almacen || 'Sin Asignar');
}

/**
 * Detecta si una matriz de filas corresponde a un Checklist de Consumibles o a uno de Equipos
 */
export function detectChecklistType(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return 'EQUIPOS';

  let hasBarcodeHeader = false;
  let hasQuantityHeader = false;
  let hasCodeHeader = false;
  let hasCommercialInvoice = false;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('commercial invoice') || rowStr.includes('zhejiang besda') || rowStr.includes('invoice #')) {
      hasCommercialInvoice = true;
    }

    row.forEach(cell => {
      const h = normalizeHeader(cell);
      if (h === 'barcode' || h === 'codigo de barras' || h === 'ean' || h === 'upc' || h.includes('barcode')) {
        hasBarcodeHeader = true;
      }
      if (h === 'quantity' || h === 'cantidad' || h === 'cant' || h === 'qty' || h === 'total quantity') {
        hasQuantityHeader = true;
      }
      if (h === 'code' || h === 'clave' || h === 'part no' || h === 'part no #' || h === 'codigo') {
        hasCodeHeader = true;
      }
    });
  }

  if (hasCommercialInvoice || (hasBarcodeHeader && hasQuantityHeader) || (hasCodeHeader && hasQuantityHeader)) {
    return 'CONSUMIBLES';
  }

  return 'EQUIPOS';
}

/**
 * Parsea un archivo Excel, CSV o texto plano de factura/llegada de consumibles
 */
export async function parseConsumablesChecklistFile(file, catalog = defaultConsumibles) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const result = parseConsumablesRows(rows, file.name, catalog);
        resolve(result);
      } catch (err) {
        reject(new Error(`Error al leer archivo de consumibles: ${err.message}`));
      }
    };

    reader.onerror = () => reject(new Error("Error al leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parsea un arreglo de filas de Excel/CSV extrayendo metadatos de factura y partidas de consumibles
 */
export function parseConsumablesRows(rows = [], fileName = 'Consumibles.xlsx', catalog = defaultConsumibles) {
  let invoiceNumber = '';
  let supplierName = '';
  let invoiceDate = '';

  let codeIndex = -1;
  let barcodeIndex = -1;
  let descriptionIndex = -1;
  let quantityIndex = -1;
  let priceIndex = -1;
  let forUseInIndex = -1;
  let oemRefIndex = -1;
  let headerRowIndex = -1;

  // 1. Extraer encabezados de factura en las primeras filas
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const rowStr = row.join(' ');
    if (!supplierName && /besda|holding|canon|ricoh|brother|sharp|kyocera|katun|ikon/i.test(rowStr)) {
      supplierName = row.find(c => typeof c === 'string' && c.trim().length > 3) || '';
    }

    row.forEach((cell, colIdx) => {
      const cStr = String(cell || '').trim();
      if (/invoice\s*#?:?/i.test(cStr)) {
        // El número suele estar en la celda contigua o en la siguiente fila
        invoiceNumber = row[colIdx + 1] || rows[i + 1]?.[colIdx] || '';
      }
      if (/date:?/i.test(cStr)) {
        invoiceDate = row[colIdx + 1] || rows[i + 1]?.[colIdx] || '';
      }
    });

    // Buscar la fila de encabezados de la tabla
    let foundCode = -1;
    let foundBarcode = -1;
    let foundDesc = -1;
    let foundQty = -1;
    let foundPrice = -1;
    let foundUseIn = -1;
    let foundOem = -1;

    row.forEach((cell, colIdx) => {
      const norm = normalizeHeader(cell);
      if (!norm) return;

      if (norm === 'code' || norm === 'clave' || norm === 'codigo' || norm === 'item' || norm === 'sku') {
        foundCode = colIdx;
      } else if (norm === 'barcode' || norm === 'codigo de barras' || norm === 'ean' || norm === 'upc' || norm.includes('barcode')) {
        foundBarcode = colIdx;
      } else if (norm === 'description' || norm === 'descripcion' || norm === 'nombre' || norm === 'producto' || norm === 'material') {
        foundDesc = colIdx;
      } else if (norm === 'quantity' || norm === 'cantidad' || norm === 'cant' || norm === 'qty' || norm === 'total quantity') {
        foundQty = colIdx;
      } else if (norm === 'unit price' || norm === 'precio' || norm === 'precio unitario' || norm === 'unit cost') {
        foundPrice = colIdx;
      } else if (norm === 'for use in' || norm === 'modelos' || norm === 'compatibilidad' || norm.includes('use in')) {
        foundUseIn = colIdx;
      } else if (norm === 'oem ref' || norm === 'oem ref #' || norm === 'ref oem' || norm === 'part no' || norm === 'part no #') {
        foundOem = colIdx;
      }
    });

    // Se considera fila de encabezado si tiene al menos código o descripción y cantidad
    if ((foundCode !== -1 || foundBarcode !== -1) && foundQty !== -1) {
      codeIndex = foundCode;
      barcodeIndex = foundBarcode;
      descriptionIndex = foundDesc;
      quantityIndex = foundQty;
      priceIndex = foundPrice;
      forUseInIndex = foundUseIn;
      oemRefIndex = foundOem;
      headerRowIndex = i;
      break;
    }
  }

  // Fallback si no encontró encabezado pero la fila 0 tiene formato estándar
  if (headerRowIndex === -1 && rows.length > 1) {
    headerRowIndex = 0;
    codeIndex = 1;
    descriptionIndex = 2;
    quantityIndex = 4;
    barcodeIndex = 3;
  }

  const items = [];
  const startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 1;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) continue;

    const rawCode = codeIndex !== -1 ? String(row[codeIndex] || '').trim() : '';
    const rawBarcode = barcodeIndex !== -1 ? String(row[barcodeIndex] || '').trim() : '';
    const rawDesc = descriptionIndex !== -1 ? String(row[descriptionIndex] || '').trim() : '';
    const rawQty = quantityIndex !== -1 ? row[quantityIndex] : 0;

    // Ignorar filas de totales o vacías
    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('total:') || rowStr.includes('us dollars') || (!rawCode && !rawBarcode && !rawDesc)) {
      continue;
    }

    const qty = parseInt(rawQty, 10);
    if (isNaN(qty) || qty <= 0) continue;

    const unitPrice = priceIndex !== -1 ? parseFloat(row[priceIndex]) || 0 : 0;
    const forUseIn = forUseInIndex !== -1 ? String(row[forUseInIndex] || '').trim() : '';
    const oemRef = oemRefIndex !== -1 ? String(row[oemRefIndex] || '').trim() : '';

    const cleanCode = rawCode.toUpperCase();
    const cleanBarcode = rawBarcode.replace(/[^0-9]/g, '');

    // Construir una descripción clara si viene vacía o 'NaN'
    let fullDesc = rawDesc && rawDesc !== 'NaN' ? rawDesc : '';
    if (!fullDesc && (forUseIn || oemRef)) {
      fullDesc = [oemRef, forUseIn].filter(Boolean).join(' - ');
    }
    if (!fullDesc) {
      fullDesc = `Consumible ${cleanCode || cleanBarcode}`;
    }

    const location = findConsumableLocation(cleanCode, cleanBarcode, catalog);

    items.push({
      id: `item_${i}_${cleanCode || cleanBarcode}`,
      rowNumber: items.length + 1,
      code: cleanCode || (cleanBarcode ? `SKU-${cleanBarcode}` : `ITEM-${items.length + 1}`),
      barcode: cleanBarcode || '',
      description: fullDesc,
      forUseIn: forUseIn,
      oemRef: oemRef,
      unitPrice: unitPrice,
      expectedQty: qty,
      scannedQty: 0,
      pendingQty: qty,
      location: location,
      status: 'PENDING', // PENDING | IN_PROGRESS | COMPLETED | SURPLUS
      scansHistory: []
    });
  }

  const totalUnits = items.reduce((acc, it) => acc + it.expectedQty, 0);

  return {
    isConsumables: true,
    batchType: 'CONSUMIBLES',
    invoiceNumber: String(invoiceNumber).trim(),
    supplierName: String(supplierName).trim(),
    invoiceDate: String(invoiceDate).trim(),
    fileName,
    items,
    totalItems: items.length,
    totalUnits
  };
}
