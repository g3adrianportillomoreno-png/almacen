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
      'Espacio': p.warehouseSpace || '',
      'Estado': p.systemStatus || 'Principal'
    }));

    const wb = XLSX.utils.book_new();

    const ws = XLSX.utils.json_to_sheet(dataRows);

    ws['!cols'] = [
      { wch: 20 }, // Clave
      { wch: 22 }, // Número de serie
      { wch: 18 }, // Número de equipo
      { wch: 16 }, // Almacén
      { wch: 14 }, // Fila
      { wch: 16 }, // Espacio
      { wch: 25 }  // Estado
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
   * Actualiza el Inventario Maestro aplicando bajas para impresoras que ya no vengan en el archivo.
   */
  static async updateMasterInventoryWithPurge(parsedRows = [], removedPrinters = []) {
    const result = await InventoryRepository.updateMasterWithPurge(parsedRows, removedPrinters);

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
   * Obtiene el historial de bajas de los últimos 30 días
   */
  static async getDeparturesHistory() {
    return await InventoryRepository.fetchDeparturesHistory();
  }

  /**
   * Exporta a Excel el historial de bajas de los últimos 30 días
   */
  static exportDeparturesReportToExcel(departures = []) {
    if (!departures || departures.length === 0) {
      alert("No hay registros de bajas para exportar.");
      return;
    }

    const dataRows = departures.map((d, idx) => ({
      'No.': idx + 1,
      'Número de Serie': d.serial || '',
      'Clave / Modelo': d.material || '',
      'Número de Equipo': d.internal_number || '',
      'Último Almacén': d.warehouse_name || '',
      'Última Fila': d.warehouse_row || '',
      'Último Espacio': d.warehouse_space || '',
      'Estado Previo': d.system_status || 'Principal',
      'Motivo': d.reason || 'Baja de inventario',
      'Fecha y Hora de Baja': d.departure_date ? new Date(d.departure_date).toLocaleString('es-MX') : ''
    }));

    const wb = XLSX.utils.book_new();


    const ws = XLSX.utils.json_to_sheet(dataRows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 25 },
      { wch: 18 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 25 },
      { wch: 30 },
      { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "HISTORIAL_BAJAS_30_DIAS");
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_Bajas_Inventario_30_Dias_${dateStr}.xlsx`);
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
    // Impresoras Dadas de Baja en este checklist
    const bajas = expected.filter(p => p.isBaja || p.status === 'BAJA');

    const isFullDone = expected.length > 0 && presentes.length >= expected.length;
    const isClosedWithPending = (batch.status === 'completed' || batch.status === 'closed') && faltantes.length > 0;
    const estadoTexto = isFullDone 
      ? 'COMPLETADO (100% Recibido)' 
      : (isClosedWithPending ? `CERRADO CON FALTANTES (${faltantes.length} faltantes)` : 'EN PROCESO / PENDIENTE');

    const wb = XLSX.utils.book_new();

    // Desglose por Documento de Origen
    const docMap = new Map();
    for (const p of expected) {
      const doc = p.documentName || batch.cleanName || batch.name || 'Documento Principal';
      if (!docMap.has(doc)) {
        docMap.set(doc, { total: 0, presentes: 0, faltantes: 0, items: [] });
      }
      const entry = docMap.get(doc);
      entry.total++;
      entry.items.push(p);
      if (completedSet.has(String(p.serial).trim().toUpperCase())) {
        entry.presentes++;
      } else {
        entry.faltantes++;
      }
    }
    const hasMultipleDocs = docMap.size > 1;

    // 1. Hoja RESUMEN
    const resumenData = [
      { 'CONCEPTO': 'FOLIO', 'DETALLE': batch.folio || 'Sin Folio' },
      { 'CONCEPTO': 'DOCUMENTO / LOTE', 'DETALLE': batch.cleanName || batch.name || 'Sin Nombre' },
      { 'CONCEPTO': 'FECHA DE REGISTRO', 'DETALLE': batch.date || new Date().toLocaleDateString('es-MX') },
      { 'CONCEPTO': 'ESTADO DEL CHECKLIST', 'DETALLE': estadoTexto },
      { 'CONCEPTO': 'TOTAL ESPERADAS', 'DETALLE': expected.length },
      { 'CONCEPTO': 'PRESENTES / ESCANEADAS', 'DETALLE': presentes.length },
      { 'CONCEPTO': 'FALTANTES', 'DETALLE': faltantes.length },
      { 'CONCEPTO': 'DADAS DE BAJA (SALIDAS)', 'DETALLE': bajas.length },
      { 'CONCEPTO': 'ERRORES / FUERA DE LISTA', 'DETALLE': inesperadas.length }
    ];

    if (hasMultipleDocs) {
      resumenData.push({ 'CONCEPTO': '--- DESGLOSE POR DOCUMENTOS ---', 'DETALLE': `${docMap.size} documentos combinados en este checklist` });
      let docNum = 1;
      for (const [docName, stats] of docMap.entries()) {
        resumenData.push({
          'CONCEPTO': `DOC #${docNum}: ${docName}`,
          'DETALLE': `${stats.presentes} de ${stats.total} leídas (${stats.faltantes} faltantes)`
        });
        docNum++;
      }
    }

    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // Ordenar presentes y faltantes por documento para mantener separaciones claras
    const sortedPresentes = [...presentes].sort((a, b) => {
      const docA = a.documentName || '';
      const docB = b.documentName || '';
      if (docA !== docB) return docA.localeCompare(docB);
      return a.serial.localeCompare(b.serial);
    });

    const sortedFaltantes = [...faltantes].sort((a, b) => {
      const docA = a.documentName || '';
      const docB = b.documentName || '';
      if (docA !== docB) return docA.localeCompare(docB);
      return a.serial.localeCompare(b.serial);
    });

    // 2. Hoja PRESENTES (Equipos escaneados correctamente)
    const dataPresentes = sortedPresentes.map((p, idx) => {
      const isBaja = p.isBaja || p.status === 'BAJA';
      const row = {
        'NO.': idx + 1,
        'CLAVE': p.material || '',
        'NUMERO DE SERIE': p.serial || '',
        'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
        'ALMACEN': p.warehouseName || 'Almacén 1',
        'FILA': p.warehouseRow || '',
        'ESPACIO': p.warehouseSpace || '',
        'ESTADO': isBaja ? 'DADA DE BAJA' : (p.status || 'DISPONIBLE'),
        'FECHA DE BAJA': isBaja && p.bajaAt ? new Date(p.bajaAt).toLocaleString('es-MX') : ''
      };
      if (hasMultipleDocs) {
        row['DOCUMENTO DE ORIGEN'] = p.documentName || 'Documento Principal';
      }
      return row;
    });

    const wsPresentes = XLSX.utils.json_to_sheet(
      dataPresentes.length > 0 ? dataPresentes : [{
        'NO.': '',
        'CLAVE': '',
        'NUMERO DE SERIE': 'SIN EQUIPOS ESCANEADOS',
        'NUMERO DE EQUIPO': '',
        'ALMACEN': '',
        'FILA': '',
        'ESPACIO': '',
        'ESTADO': '',
        ...(hasMultipleDocs ? { 'DOCUMENTO DE ORIGEN': '' } : {})
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
      { wch: 16 },
      ...(hasMultipleDocs ? [{ wch: 32 }] : [])
    ];
    XLSX.utils.book_append_sheet(wb, wsPresentes, "PRESENTES");

    // 3. Hoja FALTANTES (Equipos no encontrados físicamente)
    const dataFaltantes = sortedFaltantes.map((p, idx) => {
      const row = {
        'NO.': idx + 1,
        'CLAVE': p.material || '',
        'NUMERO DE SERIE': p.serial || '',
        'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
        'ESTADO': 'FALTANTE / NO ESCANEADA'
      };
      if (hasMultipleDocs) {
        row['DOCUMENTO DE ORIGEN'] = p.documentName || 'Documento Principal';
      }
      return row;
    });

    const wsFaltantes = XLSX.utils.json_to_sheet(
      dataFaltantes.length > 0 ? dataFaltantes : [{
        'NO.': '',
        'CLAVE': '',
        'NUMERO DE SERIE': 'NINGUNA FALTANTE (COMPLETADO AL 100%)',
        'NUMERO DE EQUIPO': '',
        'ESTADO': 'COMPLETO',
        ...(hasMultipleDocs ? { 'DOCUMENTO DE ORIGEN': '' } : {})
      }]
    );
    wsFaltantes['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 22 },
      { wch: 20 },
      { wch: 30 },
      ...(hasMultipleDocs ? [{ wch: 32 }] : [])
    ];
    XLSX.utils.book_append_sheet(wb, wsFaltantes, "FALTANTES");

    // 4. Hoja BAJAS (Equipos dados de baja / salidas del checklist con fecha)
    const sortedBajas = [...bajas].sort((a, b) => {
      const docA = a.documentName || '';
      const docB = b.documentName || '';
      if (docA !== docB) return docA.localeCompare(docB);
      return a.serial.localeCompare(b.serial);
    });

    const dataBajas = sortedBajas.map((p, idx) => {
      const row = {
        'NO.': idx + 1,
        'CLAVE': p.material || '',
        'NUMERO DE SERIE': p.serial || '',
        'NUMERO DE EQUIPO': p.internalNumber !== null && p.internalNumber !== undefined && p.internalNumber !== '' ? p.internalNumber : '',
        'ESTADO': 'DADA DE BAJA',
        'FECHA Y HORA DE BAJA': p.bajaAt ? new Date(p.bajaAt).toLocaleString('es-MX') : new Date().toLocaleString('es-MX'),
        'MOTIVO': p.bajaReason || 'Baja de checklist'
      };
      if (hasMultipleDocs) {
        row['DOCUMENTO DE ORIGEN'] = p.documentName || 'Documento Principal';
      }
      return row;
    });

    const wsBajas = XLSX.utils.json_to_sheet(
      dataBajas.length > 0 ? dataBajas : [{
        'NO.': '',
        'CLAVE': '',
        'NUMERO DE SERIE': 'SIN EQUIPOS DADOS DE BAJA',
        'NUMERO DE EQUIPO': '',
        'ESTADO': 'NINGUNO',
        'FECHA Y HORA DE BAJA': '',
        'MOTIVO': '',
        ...(hasMultipleDocs ? { 'DOCUMENTO DE ORIGEN': '' } : {})
      }]
    );
    wsBajas['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 22 },
      { wch: 20 },
      { wch: 18 },
      { wch: 24 },
      { wch: 26 },
      ...(hasMultipleDocs ? [{ wch: 32 }] : [])
    ];
    XLSX.utils.book_append_sheet(wb, wsBajas, "BAJAS");

    // Si hay más de un documento, generar pestañas separadas por cada documento
    if (hasMultipleDocs) {
      let docIndex = 1;
      for (const [docName, stats] of docMap.entries()) {
        const cleanDocTitle = docName.replace(/\.[^/.]+$/, '').replace(/[:*?/\\\[\]]/g, '_').slice(0, 18);
        const sheetName = `DOC ${docIndex} - ${cleanDocTitle}`;
        const docRows = stats.items.map((item, i) => {
          const isBaja = item.isBaja || item.status === 'BAJA';
          const isDone = completedSet.has(String(item.serial).trim().toUpperCase());
          return {
            'NO.': i + 1,
            'CLAVE': item.material || '',
            'NUMERO DE SERIE': item.serial || '',
            'ESTADO': isBaja ? 'DADA DE BAJA' : (isDone ? '✓ SÍ ESTÁ' : 'PENDIENTE / FALTANTE'),
            'FECHA DE BAJA': isBaja && item.bajaAt ? new Date(item.bajaAt).toLocaleString('es-MX') : '',
            'UBICACION': isDone && item.warehouseRow ? `${item.warehouseName || 'Almacén 1'} → ${item.warehouseRow} [${item.warehouseSpace || 'Gral'}]` : 'Sin Ubicación'
          };
        });

        const wsDoc = XLSX.utils.json_to_sheet(docRows);
        wsDoc['!cols'] = [{ wch: 6 }, { wch: 25 }, { wch: 22 }, { wch: 24 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsDoc, sheetName);
        docIndex++;
      }
    }

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

  /**
   * Guarda y aplica una sesión completa de Modo Bajas en la base de datos
   */
  static async commitBajasSession(sessionData) {
    const result = await InventoryRepository.markPrintersBajaBulk(sessionData.items, {
      bajaDate: sessionData.bajaDate,
      reason: sessionData.reason,
      operator: sessionData.operator,
      targetScope: sessionData.targetScope,
      targetLoteName: sessionData.targetLoteName
    });
    return result;
  }

  /**
   * Obtiene el historial de sesiones de bajas guardadas
   */
  static getBajasSessions() {
    return InventoryRepository.getBajasSessionsHistory();
  }

  /**
   * Genera y descarga el reporte en Excel de una sesión de bajas cerrada
   */
  static exportBajasSessionExcel(sessionRecord) {
    if (!sessionRecord || !sessionRecord.items || sessionRecord.items.length === 0) {
      alert("No hay registros en la sesión para exportar.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const dateFormatted = new Date(sessionRecord.date).toLocaleString('es-MX');

    // Desglose por modelo
    const modelCounts = {};
    const batchCounts = {};
    sessionRecord.items.forEach(it => {
      const m = it.material || 'Sin Modelo';
      const b = it.batchFolio ? `${it.batchFolio} (${it.batchName || ''})` : (it.batchName || 'General');
      modelCounts[m] = (modelCounts[m] || 0) + 1;
      batchCounts[b] = (batchCounts[b] || 0) + 1;
    });

    // 1. HOJA RESUMEN
    const resumenRows = [
      { 'CAMPO': 'FOLIO DE SESIÓN', 'VALOR': sessionRecord.folio || 'N/A' },
      { 'CAMPO': 'FECHA Y HORA DE CIERRE', 'VALOR': dateFormatted },
      { 'CAMPO': 'ÁMBITO / LOTE', 'VALOR': sessionRecord.targetLoteName || 'Todo el Inventario' },
      { 'CAMPO': 'MOTIVO GENERAL', 'VALOR': sessionRecord.reason || 'Salida de almacén' },
      { 'CAMPO': 'OPERADOR / RESPONSABLE', 'VALOR': sessionRecord.operator || 'Operador' },
      { 'CAMPO': 'TOTAL EQUIPOS DADOS DE BAJA', 'VALOR': sessionRecord.items.length },
      { 'CAMPO': '', 'VALOR': '' },
      { 'CAMPO': '--- DESGLOSE POR MODELO ---', 'VALOR': 'CANTIDAD' },
      ...Object.entries(modelCounts).map(([m, c]) => ({ 'CAMPO': m, 'VALOR': c })),
      { 'CAMPO': '', 'VALOR': '' },
      { 'CAMPO': '--- DESGLOSE POR LOTE / ORIGEN ---', 'VALOR': 'CANTIDAD' },
      ...Object.entries(batchCounts).map(([b, c]) => ({ 'CAMPO': b, 'VALOR': c }))
    ];

    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 35 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN_BAJAS");

    // 2. HOJA DETALLE DE BAJAS
    const detailRows = sessionRecord.items.map((it, idx) => ({
      'NO.': idx + 1,
      'NÚMERO DE SERIE': it.serial || '',
      'MODELO': it.material || '',
      '# EQUIPO': it.internalNumber || '',
      'LOTE ORIGEN': it.batchFolio ? `${it.batchFolio} - ${it.batchName || ''}` : (it.batchName || 'Inventario'),
      'ALMACÉN': it.warehouseName || 'Almacén 1',
      'FILA': it.warehouseRow || 'Sin Asignar',
      'ESPACIO': it.warehouseSpace || '',
      'MOTIVO': sessionRecord.reason || 'Salida de almacén',
      'FECHA Y HORA': dateFormatted,
      'HORA ESCANEO': it.scannedAt ? new Date(it.scannedAt).toLocaleTimeString('es-MX') : ''
    }));

    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 25 },
      { wch: 12 },
      { wch: 30 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 26 },
      { wch: 22 },
      { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, "EQUIPOS_DADOS_DE_BAJA");

    const safeFolio = (sessionRecord.folio || 'BAJA').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDate = new Date(sessionRecord.date).toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_${safeFolio}_${safeDate}.xlsx`);
  }

  /**
   * Genera y descarga el reporte en Excel de Bajas filtradas por rango de fechas
   */
  static exportBajasByDateExcel(departures = [], startDate = '', endDate = '', filterLote = 'ALL') {
    if (!departures || departures.length === 0) {
      alert("No hay registros de bajas en el rango de fechas seleccionado.");
      return;
    }

    const wb = XLSX.utils.book_new();

    const dataRows = departures.map((d, idx) => ({
      'NO.': idx + 1,
      'FECHA Y HORA': d.departure_date ? new Date(d.departure_date).toLocaleString('es-MX') : '',
      'NÚMERO DE SERIE': d.serial || '',
      'MODELO': d.material || '',
      '# EQUIPO': d.internal_number || '',
      'LOTE / ORIGEN': d.batchFolio ? `${d.batchFolio} (${d.batchName || ''})` : (d.batchName || 'General'),
      'ALMACÉN': d.warehouse_name || '',
      'FILA': d.warehouse_row || '',
      'ESPACIO': d.warehouse_space || '',
      'MOTIVO': d.reason || 'Baja de almacén'
    }));

    // Desglose por modelo
    const modelCounts = {};
    departures.forEach(d => {
      const m = d.material || 'Sin Modelo';
      modelCounts[m] = (modelCounts[m] || 0) + 1;
    });

    const resumenRows = [
      { 'CAMPO': 'REPORTE DE BAJAS POR FECHA', 'VALOR': '' },
      { 'CAMPO': 'PERIODO', 'VALOR': `${startDate || 'Inicio'} hasta ${endDate || 'Hoy'}` },
      { 'CAMPO': 'FILTRO LOTE', 'VALOR': filterLote === 'ALL' ? 'Todos los Lotes' : filterLote },
      { 'CAMPO': 'TOTAL EQUIPOS', 'VALOR': departures.length },
      { 'CAMPO': '', 'VALOR': '' },
      { 'CAMPO': '--- TOTALES POR MODELO ---', 'VALOR': 'CANTIDAD' },
      ...Object.entries(modelCounts).map(([m, c]) => ({ 'CAMPO': m, 'VALOR': c }))
    ];

    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    const wsData = XLSX.utils.json_to_sheet(dataRows);
    wsData['!cols'] = [
      { wch: 6 },
      { wch: 22 },
      { wch: 22 },
      { wch: 25 },
      { wch: 12 },
      { wch: 28 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 26 }
    ];
    XLSX.utils.book_append_sheet(wb, wsData, "DETALLE_BAJAS");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reporte_Bajas_Fechas_${dateStr}.xlsx`);
  }
}
