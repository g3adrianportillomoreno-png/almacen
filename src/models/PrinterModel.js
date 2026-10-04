/**
 * Modelo de Dominio: PrinterModel (Impresora / Unidad de Inventario)
 * Representa una unidad física con su número de serie, modelo, ubicación,
 * estado y el número interno de inventario asignado por el operador (ej. 1, 2... 80).
 */
export class PrinterModel {
  static STATUS_DISPONIBLE = 'DISPONIBLE';
  static STATUS_CONSULTA = 'CONSULTA';
  static STATUS_BAJA = 'BAJA';

  constructor({
    id = null,
    serial = '',
    material = '',
    checklistId = null,
    isScanned = false,
    scannedAt = null,
    warehouseRow = 'Fila 1',
    status = PrinterModel.STATUS_DISPONIBLE,
    checklistName = '',
    checklistFolio = '',
    internalNumber = null
  }) {
    this.id = id;
    this.serial = (serial || '').trim().toUpperCase();
    this.material = (material || 'Modelo Genérico').trim();
    this.checklistId = checklistId;
    this.isScanned = Boolean(isScanned);
    this.scannedAt = scannedAt;
    this.warehouseRow = warehouseRow || 'Fila 1';
    this.status = status || PrinterModel.STATUS_DISPONIBLE;
    this.checklistName = checklistName;
    this.checklistFolio = checklistFolio;
    this.internalNumber = internalNumber !== null && internalNumber !== undefined && internalNumber !== ''
      ? (isNaN(Number(internalNumber)) ? String(internalNumber) : Number(internalNumber))
      : null;
  }

  get isConsulta() {
    return this.status === PrinterModel.STATUS_CONSULTA;
  }

  get isBaja() {
    return this.status === PrinterModel.STATUS_BAJA;
  }

  get isDisponible() {
    return this.status === PrinterModel.STATUS_DISPONIBLE;
  }

  /**
   * Clases visuales de Tailwind según el estado de la impresora
   */
  getStatusBadge() {
    if (this.isConsulta) {
      return {
        label: 'CONSULTA',
        description: 'En revisión o verificación de funcionamiento en otra área',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 font-medium',
        cardBorder: 'border-amber-300 bg-amber-50/30',
        dotColor: 'bg-amber-500'
      };
    }
    if (this.isBaja) {
      return {
        label: 'BAJA',
        description: 'Unidad retirada / confirmada de salida',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 font-medium',
        cardBorder: 'border-rose-200 bg-rose-50/30 opacity-75',
        dotColor: 'bg-rose-500'
      };
    }
    return {
      label: 'DISPONIBLE',
      description: 'Disponible en fila asignada',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 font-medium',
      cardBorder: 'border-slate-200 bg-white',
      dotColor: 'bg-emerald-500'
    };
  }

  static fromDb(dbItem, checklistInfo = {}, metadataCache = {}) {
    const serial = (dbItem.serial_number || dbItem.serial || '').toUpperCase();
    const meta = metadataCache[serial] || {};
    const internalNum = dbItem.internal_number ?? meta.internalNumber ?? null;

    return new PrinterModel({
      id: dbItem.id,
      serial: serial,
      material: dbItem.material_model || dbItem.material || 'Sin Modelo',
      checklistId: dbItem.checklist_id || checklistInfo.id,
      isScanned: dbItem.is_scanned ?? false,
      scannedAt: dbItem.scanned_at || null,
      warehouseRow: dbItem.warehouse_row || meta.warehouseRow || 'Fila 1',
      status: dbItem.printer_status || meta.status || PrinterModel.STATUS_DISPONIBLE,
      checklistName: checklistInfo.name || '',
      checklistFolio: checklistInfo.folio || '',
      internalNumber: internalNum
    });
  }
}
