/**
 * Modelo de Dominio: Paquete individual de Mercado Libre
 */
export class MercadoLibreItemModel {
  constructor({
    id = null,
    batchId = null,
    guideNumber = '',
    trackingNumber = '',
    isScanned = false,
    scannedAt = null,
    scannedWith = null
  }) {
    this.id = id;
    this.batchId = batchId;
    this.guideNumber = String(guideNumber || '').trim();
    this.trackingNumber = String(trackingNumber || '').trim();
    this.isScanned = Boolean(isScanned);
    this.scannedAt = scannedAt;
    this.scannedWith = scannedWith;
  }
}

/**
 * Modelo de Dominio: Lote / Despacho de Mercado Libre
 * Representa una sesión completa con sus paquetes, lecturas e incidencias
 */
export class MercadoLibreBatchModel {
  constructor({
    id = null,
    consecutive = 1,
    folio = '',
    name = '',
    cleanName = '',
    date = '',
    status = 'pending',
    items = [],
    unexpectedLogs = []
  }) {
    this.id = id;
    this.consecutive = consecutive;
    this.folio = folio || MercadoLibreBatchModel.formatFolio(consecutive);
    this.name = name;
    this.cleanName = cleanName || MercadoLibreBatchModel.extractCleanName(name);
    this.date = date;
    this.status = status; // 'pending' | 'completed'
    this.items = items.map(it => it instanceof MercadoLibreItemModel ? it : new MercadoLibreItemModel(it));
    this.unexpectedLogs = unexpectedLogs; // Array de { id, scannedValue, createdAt } o strings
  }

  get totalCount() {
    return this.items.length;
  }

  get scannedCount() {
    return this.items.filter(it => it.isScanned).length;
  }

  get pendingCount() {
    return Math.max(0, this.totalCount - this.scannedCount);
  }

  get progressPercentage() {
    if (this.totalCount === 0) return 0;
    return Math.min(100, Math.round((this.scannedCount / this.totalCount) * 100));
  }

  get isCompleted() {
    return this.status === 'completed' || (this.totalCount > 0 && this.scannedCount >= this.totalCount);
  }

  /**
   * Obtiene los elementos escaneados
   */
  get completedItems() {
    return this.items.filter(it => it.isScanned);
  }

  /**
   * Obtiene los elementos faltantes / pendientes
   */
  get pendingItems() {
    return this.items.filter(it => !it.isScanned);
  }

  /**
   * Sugiere el siguiente consecutivo para Mercado Libre
   */
  static getNextConsecutive(batches = []) {
    if (!batches || batches.length === 0) return 1;
    const nums = batches.map(b => {
      const parsed = parseInt(b.consecutive, 10);
      return isNaN(parsed) ? 0 : parsed;
    });
    return Math.max(0, ...nums) + 1;
  }

  /**
   * Formato de folio para Mercado Libre (ej: ML-001, ML-015)
   */
  static formatFolio(num) {
    if (!num && num !== 0) return 'ML-001';
    const str = String(num).trim();
    if (/^ML-/i.test(str)) return str.toUpperCase();
    const parsed = parseInt(str, 10);
    if (!isNaN(parsed)) {
      return `ML-${String(parsed).padStart(3, '0')}`;
    }
    return `ML-${str}`;
  }

  /**
   * Extrae el nombre limpio del archivo quitando prefijos de folio
   */
  static extractCleanName(rawName = '') {
    return rawName.replace(/^\[ML-[^\]]+\]\s*/i, '').trim();
  }
}
