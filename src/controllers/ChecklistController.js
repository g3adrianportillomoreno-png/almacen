import { InventoryRepository } from '../services/InventoryRepository.js';
import { ChecklistModel } from '../models/ChecklistModel.js';

/**
 * Controlador: ChecklistController
 * Orquesta la lógica de negocio para la gestión de checklists, folios consecutivos y escaneos de lotes.
 */
export class ChecklistController {
  /**
   * Obtiene todos los lotes actualizados
   */
  static async getChecklists() {
    return await InventoryRepository.fetchAllChecklists();
  }

  /**
   * Sugiere el siguiente número consecutivo de inventario
   */
  static getNextConsecutive(checklists) {
    return ChecklistModel.getNextConsecutive(checklists);
  }

  /**
   * Crea un nuevo checklist asignándole su folio consecutivo
   */
  static async createChecklist(fileName, series, consecutiveNumber) {
    if (!series || series.length === 0) {
      throw new Error('No hay números de serie para registrar.');
    }
    const finalConsecutive = consecutiveNumber || 1;
    return await InventoryRepository.createChecklist(fileName, series, finalConsecutive);
  }

  /**
   * Registra el escaneo exitoso de una unidad asignándole su fila y su número de inventario
   */
  static async recordSuccessfulScan(checklistId, serial, warehouseRow, currentBatch, internalNumber = null) {
    // 1. Guardar en repositorio / BD
    await InventoryRepository.registerScan(checklistId, serial, warehouseRow, internalNumber);

    // 2. Verificar si con este escaneo el lote queda 100% completado
    const newCompletedCount = (currentBatch.completed?.length || 0) + 1;
    if (newCompletedCount >= currentBatch.expectedSeries?.length) {
      await InventoryRepository.markChecklistCompleted(checklistId);
      return { isFullyCompleted: true };
    }

    return { isFullyCompleted: false };
  }

  /**
   * Registra una serie fuera de lista / inesperada
   */
  static async recordUnexpectedScan(checklistId, serial) {
    await InventoryRepository.logUnexpectedScan(checklistId, serial);
  }

  /**
   * Elimina un checklist completo
   */
  static async removeChecklist(checklistId) {
    await InventoryRepository.deleteChecklist(checklistId);
  }

  /**
   * Fuerza el cierre prematuro de un checklist
   */
  static async forceFinishChecklist(checklistId) {
    await InventoryRepository.markChecklistCompleted(checklistId);
  }
}
