import { InventoryRepository } from '../services/InventoryRepository.js';
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
   */
  static extractAllPrinters(checklists = []) {
    const list = [];
    const seenSerials = new Set();

    for (const batch of checklists) {
      for (const printer of (batch.expectedSeries || [])) {
        if (!seenSerials.has(printer.serial)) {
          seenSerials.add(printer.serial);
          list.push(printer);
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
   * Genera y descarga un archivo Excel completo con los equipos asignados y los faltantes
   * @param {Array<PrinterModel>} allPrinters
   */
  static exportInventoryReportToExcel(allPrinters = []) {
    if (!allPrinters || allPrinters.length === 0) {
      alert("No hay equipos registrados en el inventario para exportar.");
      return;
    }

    // Dividir entre equipos que ya tienen espacio asignado (o escaneados con ubicación) y faltantes
    const asignados = allPrinters.filter(p => p.warehouseSpace || p.isScanned);
    const faltantes = allPrinters.filter(p => !p.warehouseSpace && !p.isScanned);

    // Mapear datos para Hoja 1: Asignados
    // Columnas exactas: CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO, ALMACEN, FILA, ESPACIO
    const dataAsignados = asignados.map((p) => ({
      'CLAVE': p.material || '',
      'NUMERO DE SERIE': p.serial || '',
      'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
      'ALMACEN': p.warehouseName || 'Almacén 1',
      'FILA': p.warehouseRow || 'Fila 1',
      'ESPACIO': p.warehouseSpace || ''
    }));

    // Mapear datos para Hoja 2: Faltantes
    const dataFaltantes = faltantes.map((p) => ({
      'CLAVE': p.material || '',
      'NUMERO DE SERIE': p.serial || '',
      'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
      'ALMACEN': '',
      'FILA': '',
      'ESPACIO': ''
    }));

    // Crear libro de trabajo
    const wb = XLSX.utils.book_new();

    // Crear hojas
    const wsAsignados = XLSX.utils.json_to_sheet(
      dataAsignados.length > 0 ? dataAsignados : [{
        'CLAVE': '',
        'NUMERO DE SERIE': '',
        'NUMERO DE EQUIPO': '',
        'ALMACEN': '',
        'FILA': '',
        'ESPACIO': ''
      }]
    );
    const wsFaltantes = XLSX.utils.json_to_sheet(
      dataFaltantes.length > 0 ? dataFaltantes : [{
        'CLAVE': '',
        'NUMERO DE SERIE': '',
        'NUMERO DE EQUIPO': '',
        'ALMACEN': '',
        'FILA': '',
        'ESPACIO': ''
      }]
    );

    // Configurar anchos de columna recomendados
    const colWidths = [
      { wch: 25 }, // CLAVE
      { wch: 22 }, // NUMERO DE SERIE
      { wch: 20 }, // NUMERO DE EQUIPO
      { wch: 18 }, // ALMACEN
      { wch: 15 }, // FILA
      { wch: 18 }  // ESPACIO
    ];
    wsAsignados['!cols'] = colWidths;
    wsFaltantes['!cols'] = colWidths;

    // Agregar hojas al libro
    XLSX.utils.book_append_sheet(wb, wsAsignados, "ASIGNADOS");
    XLSX.utils.book_append_sheet(wb, wsFaltantes, "FALTANTES");

    // Descargar archivo
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Inventario_Almacen_CDM_${dateStr}.xlsx`;
    XLSX.writeFile(wb, fileName);
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

