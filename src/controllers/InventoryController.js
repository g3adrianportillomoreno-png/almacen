import { InventoryRepository } from '../services/InventoryRepository.js';
import { WarehouseMapController } from './WarehouseMapController.js';
import { PrinterModel } from '../models/PrinterModel.js';
import * as XLSX from 'xlsx';

/**
 * Controlador: InventoryController
 * Gestiona el inventario global de impresoras: búsqueda por MODELO,
 * asignación de Almacén/Fila/Espacio, cambio de estado y exportación a Excel.
 */
export class InventoryController {
  /**
   * Extrae todas las impresoras registradas a lo largo de todos los lotes
   * @param {Array} checklists Lista de instancias ChecklistModel
   * @returns {Array<PrinterModel>}
  /**
   * Extrae todas las impresoras del inventario de almacén:
   * Incluye las del lote de Inventario Maestro Y aquellas de checklists de recepción
   * a las que ya se les haya dado lectura física (escaneadas).
   * Los checklists recién subidos NO se agregan al inventario hasta que se les dé lectura.
   * @param {Array} checklists Lista de instancias ChecklistModel
   * @returns {Array<PrinterModel>}
   */
  static extractAllPrinters(checklists = []) {
    const list = [];
    const seenSerials = new Set();

    for (const batch of checklists) {
      const isMasterBatch = batch.isMaster || batch.folio === 'MAESTRO' || (batch.name || '').toLowerCase().includes('inventario maestro') || !batch.folio;

      for (const printer of (batch.expectedSeries || [])) {
        if (!printer.serial) continue;
        const serialUpper = String(printer.serial).trim().toUpperCase();

        if (!seenSerials.has(serialUpper)) {
          // Si es del lote de inventario maestro, ya está en almacén.
          // Si es de un checklist de recepción, SÓLO se incluye si ya se le dio lectura (isScanned === true o está en completed).
          const isRead = Boolean(printer.isScanned) || Boolean(batch.completed && batch.completed.includes(serialUpper));

          if (isMasterBatch || isRead) {
            seenSerials.add(serialUpper);
            list.push(printer);
          }
        }
      }
    }
    return list;
  }

  /**
   * Extrae absolutamente todas las impresoras esperadas/registradas en el sistema
   * (tanto de almacén maestro como de checklists pendientes de lectura física).
   * Útil para la pantalla de Lectura de Equipos para buscar o listar las que faltan por ubicar.
   */
  static extractAllExpectedPrinters(checklists = []) {
    const list = [];
    const seenSerials = new Set();

    for (const batch of checklists) {
      for (const printer of (batch.expectedSeries || [])) {
        if (!printer.serial) continue;
        const serialUpper = String(printer.serial).trim().toUpperCase();

        if (!seenSerials.has(serialUpper)) {
          seenSerials.add(serialUpper);
          list.push({
            ...printer,
            batchId: batch.id,
            batchFolio: batch.folio,
            batchName: batch.cleanName || batch.name
          });
        }
      }
    }
    return list;
  }

  /**
   * Obtiene la lista ordenada de modelos únicos para sugerencias y filtros rápidos
   */
  static getUniqueModels(printers = []) {
    const models = new Set();
    for (const p of printers) {
      if (p.material && p.material.trim()) {
        models.add(p.material.trim());
      }
    }
    return Array.from(models).sort();
  }

  /**
   * Filtra impresoras por término de búsqueda en MODELO o SERIE y por estado
   */
  static filterPrinters(printers = [], modelQuery = '', statusFilter = 'ALL') {
    const query = (modelQuery || '').trim().toLowerCase();

    return printers.filter(p => {
      // Filtro por modelo (o serie si el usuario escribe serie)
      const matchesModel = !query || 
        p.material.toLowerCase().includes(query) || 
        p.serial.toLowerCase().includes(query);

      if (!matchesModel) return false;

      // Filtro por estado
      if (statusFilter === 'ALL') return true;
      if (statusFilter === PrinterModel.STATUS_CONSULTA) return p.isConsulta;
      if (statusFilter === PrinterModel.STATUS_BAJA) return p.isBaja;
      if (statusFilter === PrinterModel.STATUS_DISPONIBLE) return p.isDisponible;

      return true;
    });
  }

  /**
   * Cambia el estado de una impresora a 'CONSULTA'
   * (Pasa a color amarillo indicando que está en otra área o verificando si funciona)
   */
  static async markAsConsulta(serial) {
    await InventoryRepository.updatePrinterStatus(serial, PrinterModel.STATUS_CONSULTA);
  }

  /**
   * Cambia el estado de una impresora a 'BAJA'
   * (Confirma que la impresora ya se va / salida del almacén)
   */
  static async markAsBaja(serial) {
    await InventoryRepository.updatePrinterStatus(serial, PrinterModel.STATUS_BAJA);
  }

  /**
   * Restablece el estado de una impresora a 'DISPONIBLE' / 'EN ALMACÉN'
   */
  static async resetToDisponible(serial) {
    await InventoryRepository.updatePrinterStatus(serial, PrinterModel.STATUS_DISPONIBLE);
  }

  /**
   * Reubica una impresora en otra Fila
   */
  static async changeRow(serial, newRow) {
    await InventoryRepository.updatePrinterRow(serial, newRow);
  }

  /**
   * Asigna Almacén, Fila y Espacio a una impresora
   */
  static async assignPrinter(serial, locationData) {
    return await InventoryRepository.assignPrinterLocation(serial, locationData);
  }

  /**
   * Genera y descarga el archivo Excel Maestro con todas las impresoras de almacén
   * Formato oficial:
   * Clave | Número de serie | Número de equipo | Almacén | Fila | Espacio
   * @param {Array<PrinterModel>} allPrinters
   */
  static exportInventoryReportToExcel(allPrinters = []) {
    if (!allPrinters || allPrinters.length === 0) {
      alert("No hay equipos registrados en el inventario para exportar.");
      return;
    }

    const dataRows = allPrinters.map((p) => ({
      'Clave': p.material || '',
      'Número de serie': p.serial || '',
      'Número de equipo': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
      'Almacén': p.warehouseName || '',
      'Fila': p.warehouseRow && p.warehouseRow !== 'Sin Asignar' ? p.warehouseRow : '',
      'Espacio': p.warehouseSpace || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataRows);

    ws['!cols'] = [
      { wch: 20 }, // Clave
      { wch: 22 }, // Número de serie
      { wch: 18 }, // Número de equipo
      { wch: 16 }, // Almacén
      { wch: 14 }, // Fila
      { wch: 16 }  // Espacio
    ];

    XLSX.utils.book_append_sheet(wb, ws, "INVENTARIO_ALMACEN");

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Inventario_Maestro_Almacen_${dateStr}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  /**
   * Reconcilia e importa filas desde un archivo Excel Maestro de forma ultrarrápida:
   * Procesa cientos de filas en bloques masivos (menos de 1 segundo).
   */
  static async reconcileAndImportMasterExcel(parsedRows = []) {
    if (!parsedRows || parsedRows.length === 0) return { updated: 0, added: 0, total: 0 };

    // 1. Reconciliación masiva en Supabase y caché local
    const result = await InventoryRepository.reconcileBatchPrinters(parsedRows);

    // 2. Registrar almacenes y filas en el plano del mapa en una sola pasada
    try {
      let mapModel = WarehouseMapController.loadMap();
      let mapChanged = false;
      for (const item of parsedRows) {
        if (item.warehouseRow && item.warehouseRow.trim() && item.warehouseRow !== 'Sin Asignar') {
          const updated = mapModel.ensureRowExists(item.warehouseRow, item.warehouseName);
          if (updated !== mapModel) {
            mapModel = updated;
            mapChanged = true;
          }
        }
      }
      if (mapChanged) {
        WarehouseMapController.saveMap(mapModel);
      }
    } catch (err) {
      console.warn("Error sincronizando filas en layout del mapa:", err);
    }

    return result;
  }

  /**
   * Depura los checklists completados sin perder las impresoras asociadas.
   */
  static async clearCompletedChecklists(completedBatchIds = []) {
    return await InventoryRepository.clearCompletedChecklists(completedBatchIds);
  }

  /**
   * Genera y descarga el reporte en Excel de un checklist específico:
   * Incluye hojas para Resumen, Equipos Presentes/Escaneados, Faltantes y Errores/Inesperadas.
   * @param {Object} batch Instancia de ChecklistModel o datos del lote
   */
  static exportChecklistReportToExcel(batch) {
    if (!batch) {
      alert("No se encontró información del checklist para exportar.");
      return;
    }

    const expected = batch.expectedSeries || [];
    const completedList = batch.completed || [];
    const completedSet = new Set(completedList.map(s => String(s).trim().toUpperCase()));

    // Impresoras Presentes / Escaneadas
    const presentes = expected.filter(p => completedSet.has(String(p.serial).trim().toUpperCase()));
    // Impresoras Faltantes
    const faltantes = expected.filter(p => !completedSet.has(String(p.serial).trim().toUpperCase()));
    // Lecturas fuera de lista / Errores
    const inesperadas = batch.unexpectedLogs || [];

    const isFullDone = expected.length > 0 && presentes.length >= expected.length;
    const isClosedWithPending = (batch.status === 'completed' || batch.status === 'closed') && faltantes.length > 0;
    const estadoTexto = isFullDone 
      ? 'COMPLETADO (100% Recibido)' 
      : (isClosedWithPending ? `CERRADO CON FALTANTES (${faltantes.length} faltantes)` : 'EN PROCESO / PENDIENTE');

    const wb = XLSX.utils.book_new();

    // 1. Hoja RESUMEN
    const resumenData = [
      { 'CONCEPTO': 'FOLIO', 'DETALLE': batch.folio || 'Sin Folio' },
      { 'CONCEPTO': 'DOCUMENTO / LOTE', 'DETALLE': batch.cleanName || batch.name || 'Sin Nombre' },
      { 'CONCEPTO': 'FECHA DE REGISTRO', 'DETALLE': batch.date || new Date().toLocaleDateString('es-MX') },
      { 'CONCEPTO': 'ESTADO DEL CHECKLIST', 'DETALLE': estadoTexto },
      { 'CONCEPTO': 'TOTAL ESPERADAS', 'DETALLE': expected.length },
      { 'CONCEPTO': 'PRESENTES / ESCANEADAS', 'DETALLE': presentes.length },
      { 'CONCEPTO': 'FALTANTES', 'DETALLE': faltantes.length },
      { 'CONCEPTO': 'ERRORES / FUERA DE LISTA', 'DETALLE': inesperadas.length }
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 28 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // 2. Hoja PRESENTES (Equipos escaneados correctamente)
    const dataPresentes = presentes.map((p, idx) => ({
      'NO.': idx + 1,
      'CLAVE': p.material || '',
      'NUMERO DE SERIE': p.serial || '',
      'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
      'ALMACEN': p.warehouseName || 'Almacén 1',
      'FILA': p.warehouseRow || '',
      'ESPACIO': p.warehouseSpace || '',
      'ESTADO': p.status || 'DISPONIBLE'
    }));
    const wsPresentes = XLSX.utils.json_to_sheet(
      dataPresentes.length > 0 ? dataPresentes : [{
        'NO.': '',
        'CLAVE': '',
        'NUMERO DE SERIE': 'SIN EQUIPOS ESCANEADOS',
        'NUMERO DE EQUIPO': '',
        'ALMACEN': '',
        'FILA': '',
        'ESPACIO': '',
        'ESTADO': ''
      }]
    );
    wsPresentes['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 22 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 }
    ];
    XLSX.utils.book_append_sheet(wb, wsPresentes, "PRESENTES");

    // 3. Hoja FALTANTES (Equipos no encontrados físicamente)
    const dataFaltantes = faltantes.map((p, idx) => ({
      'NO.': idx + 1,
      'CLAVE': p.material || '',
      'NUMERO DE SERIE': p.serial || '',
      'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
      'ESTADO': 'FALTANTE / NO ESCANEADA'
    }));
    const wsFaltantes = XLSX.utils.json_to_sheet(
      dataFaltantes.length > 0 ? dataFaltantes : [{
        'NO.': '',
        'CLAVE': '',
        'NUMERO DE SERIE': 'NINGUNA FALTANTE (COMPLETADO AL 100%)',
        'NUMERO DE EQUIPO': '',
        'ESTADO': 'COMPLETO'
      }]
    );
    wsFaltantes['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 22 },
      { wch: 20 },
      { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, wsFaltantes, "FALTANTES");

    // 4. Hoja ERRORES E INCIDENCIAS (Lecturas fuera de lista o no esperadas)
    const dataErrores = inesperadas.map((serial, idx) => ({
      'NO.': idx + 1,
      'VALOR ESCANEADO': serial,
      'INCIDENCIA': 'SERIE FUERA DE LISTA (NO REGISTRADA EN ESTE CHECKLIST)'
    }));
    const wsErrores = XLSX.utils.json_to_sheet(
      dataErrores.length > 0 ? dataErrores : [{
        'NO.': '',
        'VALOR ESCANEADO': 'SIN ERRORES REGISTRADOS',
        'INCIDENCIA': 'NINGUNA'
      }]
    );
    wsErrores['!cols'] = [
      { wch: 6 },
      { wch: 26 },
      { wch: 45 }
    ];
    XLSX.utils.book_append_sheet(wb, wsErrores, "INCIDENCIAS_ERRORES");

    // Descargar libro Excel
    const safeFolio = (batch.folio || 'Checklist').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Reporte_Checklist_${safeFolio}_${dateStr}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }
}

