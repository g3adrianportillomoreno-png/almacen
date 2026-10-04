import { InventoryRepository } from '../services/InventoryRepository.js';
import { PrinterModel } from '../models/PrinterModel.js';

/**
 * Controlador: InventoryController
 * Gestiona el inventario global de impresoras: búsqueda por MODELO,
 * y cambio de estado a CONSULTA (amarillo) y BAJA (confirmación de salida).
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
}
