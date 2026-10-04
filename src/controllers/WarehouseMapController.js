import { InventoryRepository } from '../services/InventoryRepository.js';
import { WarehouseMapModel } from '../models/WarehouseMapModel.js';

/**
 * Controlador: WarehouseMapController
 * Coordina la gestión de múltiples almacenes (Almacén 1 y 2), renombramiento de mapa,
 * manipulación de rectángulos compactos y cálculo de rangos numéricos.
 */
export class WarehouseMapController {
  /**
   * Carga el estado del mapa de almacén
   */
  static loadMap() {
    return InventoryRepository.loadMapLayout();
  }

  /**
   * Guarda el estado del mapa
   */
  static saveMap(mapModel) {
    InventoryRepository.saveMapLayout(mapModel);
  }

  /**
   * Cambia el almacén activo (ej. Almacén 1 o Almacén 2)
   */
  static changeActiveWarehouse(mapModel, warehouseId) {
    const updated = mapModel.setActiveWarehouse(warehouseId);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Renombra un almacén o el título del mapa
   */
  static renameWarehouse(mapModel, warehouseId, newName) {
    const updated = mapModel.renameWarehouse(warehouseId, newName);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Agrega un nuevo almacén
   */
  static addNewWarehouse(mapModel, name) {
    const updated = mapModel.addWarehouse(name);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Modifica el nombre de una Fila y sincroniza las impresoras asignadas
   */
  static renameRow(mapModel, rowId, newName) {
    const activeWh = mapModel.getActiveWarehouse();
    const oldRow = activeWh?.rows.find(r => r.id === rowId);
    const updated = mapModel.renameRow(rowId, newName);
    InventoryRepository.saveMapLayout(updated);
    if (oldRow && oldRow.name !== newName) {
      InventoryRepository.renameWarehouseRowInCache(oldRow.name, newName);
    }
    return updated;
  }

  /**
   * Agrega una nueva Fila compacta al almacén activo
   */
  static addNewRow(mapModel, name) {
    const updated = mapModel.addRow(name);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Elimina una fila del almacén activo
   */
  static deleteRow(mapModel, rowId) {
    const updated = mapModel.removeRow(rowId);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Actualiza la posición de un rectángulo en el almacén activo
   */
  static moveRow(mapModel, rowId, coords) {
    const updated = mapModel.updateRowPosition(rowId, coords);
    InventoryRepository.saveMapLayout(updated);
    return updated;
  }

  /**
   * Obtiene las estadísticas para todas las filas del almacén activo
   */
  static getStatsForAllRows(mapModel, allPrinters = []) {
    const statsMap = {};
    for (const row of mapModel.rows) {
      statsMap[row.name] = WarehouseMapModel.calculateRowStats(row.name, allPrinters);
    }
    return statsMap;
  }
}
