import { PrinterModel } from './PrinterModel.js';

/**
 * Modelo de Dominio: ChecklistModel (Lote de Recepción)
 * Maneja el consecutivo de inventario, nombre, estado, series y lecturas.
 */
export class ChecklistModel {
  constructor({
    id = null,
    consecutive = 1,
    folio = '',
    name = '',
    cleanName = '',
    date = '',
    status = 'pending',
    expectedSeries = [],
    completed = [],
    unexpectedLogs = []
  }) {
    this.id = id;
    this.consecutive = consecutive;
    this.folio = folio || ChecklistModel.formatFolio(consecutive);
    this.name = name;
    this.cleanName = cleanName || ChecklistModel.extractCleanName(name);
    this.date = date;
    this.status = status;
    this.expectedSeries = expectedSeries; // Array of PrinterModel instances
    this.completed = completed; // Array of scanned serial strings
    this.unexpectedLogs = unexpectedLogs; // Array of unexpected scanned serial strings
  }

  get isCompleted() {
    return this.status === 'completed' || (this.expectedSeries.length > 0 && this.completed.length >= this.expectedSeries.length);
  }

  get isMaster() {
    const nameLower = (this.name || '').toLowerCase();
    const cleanLower = (this.cleanName || '').toLowerCase();
    const folioLower = (this.folio || '').toLowerCase();
    return (
      nameLower.includes('inventario maestro') ||
      cleanLower.includes('inventario maestro') ||
      folioLower === 'maestro' ||
      nameLower === 'maestro'
    );
  }

  get totalCount() {
    return this.expectedSeries.length;
  }

  get scannedCount() {
    return this.completed.length;
  }

  get pendingCount() {
    return Math.max(0, this.totalCount - this.scannedCount);
  }

  get progressPercentage() {
    if (this.totalCount === 0) return 0;
    return Math.min(100, Math.round((this.scannedCount / this.totalCount) * 100));
  }

  /**
   * Sugiere el siguiente consecutivo solo a partir de checklists de recepción de equipos nuevos
   */
  static getNextConsecutive(checklists = []) {
    const receptionBatches = (checklists || []).filter(c => !c.isMaster);
    if (receptionBatches.length === 0) return 1;

    const nums = receptionBatches.map(c => {
      const parsed = parseInt(c.consecutive, 10);
      return isNaN(parsed) ? 0 : parsed;
    });

    const max = Math.max(0, ...nums);
    return max + 1;
  }

  /**
   * Formatea el folio manual ingresado por el operador
   */
  static formatFolio(num) {
    if (!num && num !== 0) return 'Sin Folio';
    const str = String(num).trim();
    if (/^folio/i.test(str) || /^maestro/i.test(str)) return str;
    return `FOLIO #${str}`;
  }

  /**
   * Extrae el nombre limpio del archivo quitando prefijos de folio
   */
  static extractCleanName(rawName = '') {
    return rawName.replace(/^\[FOLIO #[^\]]+\]\s*/i, '').replace(/^Lote:\s*/i, 'Lote: ').trim();
  }

  /**
   * Extrae el número consecutivo a partir del nombre o metadatos
   */
  static extractConsecutive(rawName = '', fallbackConsecutive = '') {
    const match = rawName.match(/\[FOLIO #([^\]]+)\]/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return fallbackConsecutive;
  }

  /**
   * Factoría desde registro de Supabase
   */
  static fromDb(dbBatch, index = 0, metadataCache = {}) {
    const rawName = dbBatch.name || '';
    const isMasterBatch = rawName.toLowerCase().includes('inventario maestro') || (dbBatch.folio || '').toUpperCase() === 'MAESTRO';

    const consecutive = isMasterBatch
      ? null
      : (dbBatch.consecutive_number 
         || ChecklistModel.extractConsecutive(rawName, null) 
         || (metadataCache.checklists?.[dbBatch.id]?.consecutive)
         || (index + 1));

    const folio = isMasterBatch
      ? 'MAESTRO'
      : (dbBatch.folio || ChecklistModel.formatFolio(consecutive));

    const checklistInfo = {
      id: dbBatch.id,
      name: rawName,
      folio: folio
    };

    const expectedSeries = (dbBatch.expected_series || []).map(s => 
      PrinterModel.fromDb(s, checklistInfo, metadataCache.serials || {})
    );

    const completed = expectedSeries
      .filter(s => s.isScanned)
      .map(s => s.serial);

    const unexpectedLogs = (dbBatch.unexpected_logs || []).map(log => 
      log.scanned_value || log
    );

    return new ChecklistModel({
      id: dbBatch.id,
      consecutive: consecutive,
      folio: folio,
      name: dbBatch.name,
      cleanName: ChecklistModel.extractCleanName(dbBatch.name),
      date: new Date(dbBatch.created_at).toLocaleDateString('es-MX'),
      status: dbBatch.status,
      expectedSeries: expectedSeries,
      completed: completed,
      unexpectedLogs: unexpectedLogs
    });
  }
}
