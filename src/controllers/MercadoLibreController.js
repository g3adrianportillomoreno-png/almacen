import * as XLSX from 'xlsx';
import { MercadoLibreRepository } from '../services/MercadoLibreRepository.js';
import { MercadoLibreBatchModel } from '../models/MercadoLibreModel.js';

/**
 * Controlador de Negocio: MercadoLibreController (Patrón MVC)
 * Gestiona el ciclo de vida de los lotes de despacho de Mercado Libre y la exportación de reportes.
 */
export class MercadoLibreController {
  /**
   * Obtiene todos los lotes de Mercado Libre
   */
  static async getBatches() {
    return await MercadoLibreRepository.fetchAllBatches();
  }

  /**
   * Obtiene el siguiente consecutivo para el lote
   */
  static getNextConsecutive(batches) {
    return MercadoLibreBatchModel.getNextConsecutive(batches);
  }

  /**
   * Crea un nuevo lote de paquetes de Mercado Libre
   */
  static async createBatch(fileName, items, consecutiveNumber) {
    if (!items || items.length === 0) {
      throw new Error('El archivo no contiene paquetes válidos para registrar.');
    }
    const finalConsecutive = consecutiveNumber || 1;
    return await MercadoLibreRepository.createBatch(fileName, items, finalConsecutive);
  }

  /**
   * Registra el escaneo exitoso de un paquete y evalúa si el lote queda 100% completado
   */
  static async recordSuccessfulScan(batchId, itemId, scannedWith = 'gun', currentBatch = null) {
    await MercadoLibreRepository.registerScan(batchId, itemId, scannedWith);

    if (currentBatch) {
      const alreadyScanned = currentBatch.scannedCount || currentBatch.items.filter(it => it.isScanned).length;
      const total = currentBatch.totalCount || currentBatch.items.length;
      
      if (alreadyScanned + 1 >= total && total > 0) {
        await MercadoLibreRepository.markBatchCompleted(batchId);
        return { isFullyCompleted: true };
      }
    }

    return { isFullyCompleted: false };
  }

  /**
   * Registra una lectura fuera de lista / no encontrada (incidencia)
   */
  static async recordUnexpectedScan(batchId, scannedValue) {
    await MercadoLibreRepository.logUnexpectedScan(batchId, scannedValue);
  }

  /**
   * Elimina un lote de Mercado Libre
   */
  static async deleteBatch(batchId) {
    await MercadoLibreRepository.deleteBatch(batchId);
  }

  /**
   * Cierra manualmente el lote aunque queden faltantes
   */
  static async forceFinishBatch(batchId) {
    await MercadoLibreRepository.markBatchCompleted(batchId);
  }

  /**
   * Exporta el reporte oficial de Mercado Libre en formato Excel con 4 hojas detalladas
   */
  static exportBatchReportToExcel(batch) {
    if (!batch) return;

    const items = batch.items || [];
    const escaneados = items.filter(it => it.isScanned);
    const faltantes = items.filter(it => !it.isScanned);
    const incidencias = batch.unexpectedLogs || [];

    const isFullDone = items.length > 0 && escaneados.length >= items.length;
    const isClosedWithPending = batch.status === 'completed' && faltantes.length > 0;
    const estadoTexto = isFullDone 
      ? 'COMPLETADO (100% Despachado / Verificado)' 
      : (isClosedWithPending ? `CERRADO CON FALTANTES (${faltantes.length} pendientes)` : 'EN PROCESO DE ESCANEO');

    const wb = XLSX.utils.book_new();

    // 1. HOJA RESUMEN
    const resumenData = [
      { 'CONCEPTO': 'MÓDULO', 'DETALLE': 'MERCADO LIBRE - CONTROL DE GUÍAS Y RASTREO' },
      { 'CONCEPTO': 'FOLIO', 'DETALLE': batch.folio || 'Sin Folio' },
      { 'CONCEPTO': 'ARCHIVO / LOTE', 'DETALLE': batch.cleanName || batch.name || 'Sin Nombre' },
      { 'CONCEPTO': 'FECHA DE REGISTRO', 'DETALLE': batch.date || new Date().toLocaleDateString('es-MX') },
      { 'CONCEPTO': 'ESTADO DEL DESPACHO', 'DETALLE': estadoTexto },
      { 'CONCEPTO': 'TOTAL PAQUETES ESPERADOS', 'DETALLE': items.length },
      { 'CONCEPTO': 'PAQUETES ESCANEADOS / VERIFICADOS', 'DETALLE': escaneados.length },
      { 'CONCEPTO': 'PAQUETES FALTANTES', 'DETALLE': faltantes.length },
      { 'CONCEPTO': 'PORCENTAJE DE AVANCE', 'DETALLE': `${batch.progressPercentage || Math.round((escaneados.length / (items.length || 1)) * 100)}%` },
      { 'CONCEPTO': 'LECTURAS FUERA DE LISTA (ERRORES)', 'DETALLE': incidencias.length }
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 35 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // 2. HOJA ESCANEADOS
    const dataEscaneados = escaneados.map((it, idx) => {
      let fechaHora = '';
      if (it.scannedAt) {
        try {
          fechaHora = new Date(it.scannedAt).toLocaleString('es-MX');
        } catch {
          fechaHora = String(it.scannedAt);
        }
      }
      return {
        'NO.': idx + 1,
        'NÚMERO DE GUÍA': it.guideNumber || '',
        'NÚMERO DE RASTREO': it.trackingNumber || '',
        'FECHA Y HORA DE ESCANEO': fechaHora || 'Registrado',
        'MÉTODO DE LECTURA': it.scannedWith === 'camera' ? 'Cámara' : (it.scannedWith === 'manual' ? 'Manual' : 'Pistola Láser'),
        'ESTADO': 'VERIFICADO / ESCANEADO'
      };
    });

    const wsEscaneados = XLSX.utils.json_to_sheet(
      dataEscaneados.length > 0 ? dataEscaneados : [{
        'NO.': '',
        'NÚMERO DE GUÍA': 'SIN PAQUETES ESCANEADOS',
        'NÚMERO DE RASTREO': '',
        'FECHA Y HORA DE ESCANEO': '',
        'MÉTODO DE LECTURA': '',
        'ESTADO': ''
      }]
    );
    wsEscaneados['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 28 },
      { wch: 26 },
      { wch: 18 },
      { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(wb, wsEscaneados, "ESCANEADOS");

    // 3. HOJA FALTANTES
    const dataFaltantes = faltantes.map((it, idx) => ({
      'NO.': idx + 1,
      'NÚMERO DE GUÍA': it.guideNumber || '',
      'NÚMERO DE RASTREO': it.trackingNumber || '',
      'ESTADO': 'PENDIENTE / FALTANTE DE ESCANEAR'
    }));

    const wsFaltantes = XLSX.utils.json_to_sheet(
      dataFaltantes.length > 0 ? dataFaltantes : [{
        'NO.': '',
        'NÚMERO DE GUÍA': 'NINGÚN FALTANTE (LOTE 100% COMPLETADO)',
        'NÚMERO DE RASTREO': '',
        'ESTADO': 'COMPLETO'
      }]
    );
    wsFaltantes['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 28 },
      { wch: 35 }
    ];
    XLSX.utils.book_append_sheet(wb, wsFaltantes, "FALTANTES");

    // 4. HOJA INCIDENCIAS / FUERA DE LISTA
    const dataIncidencias = incidencias.map((inc, idx) => {
      const val = typeof inc === 'string' ? inc : (inc?.scannedValue || '');
      let fechaHora = '';
      if (inc?.createdAt) {
        try {
          fechaHora = new Date(inc.createdAt).toLocaleString('es-MX');
        } catch {
          fechaHora = String(inc.createdAt);
        }
      }
      return {
        'NO.': idx + 1,
        'CÓDIGO ESCANEADO': val,
        'FECHA Y HORA': fechaHora || 'Registrado',
        'INCIDENCIA': 'CÓDIGO NO ENCONTRADO EN ESTE LOTE (FUERA DE LISTA / REPETIDO EXTRAÑO)'
      };
    });

    const wsIncidencias = XLSX.utils.json_to_sheet(
      dataIncidencias.length > 0 ? dataIncidencias : [{
        'NO.': '',
        'CÓDIGO ESCANEADO': 'SIN INCIDENCIAS REGISTRADAS',
        'FECHA Y HORA': '',
        'INCIDENCIA': 'NINGUNA'
      }]
    );
    wsIncidencias['!cols'] = [
      { wch: 6 },
      { wch: 30 },
      { wch: 24 },
      { wch: 55 }
    ];
    XLSX.utils.book_append_sheet(wb, wsIncidencias, "INCIDENCIAS_ERRORES");

    // Descargar archivo Excel
    const safeFolio = (batch.folio || 'MercadoLibre').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Reporte_MercadoLibre_${safeFolio}_${dateStr}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }
}

