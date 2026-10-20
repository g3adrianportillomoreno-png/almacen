/**
 * Modelo de Dominio: PrinterModel (Impresora / Unidad de Inventario)
 * Representa una unidad física con su número de serie, modelo, ubicación,
 * estado y el número interno de inventario asignado por el operador (ej. 1, 2... 80).
 */
export class PrinterModel {
  static STATUS_DISPONIBLE = 'DISPONIBLE';
  static STATUS_CONSULTA = 'CONSULTA';
  static STATUS_BAJA = 'BAJA';

  // Estados de Proceso / Sistema en Almacén
  static SYSTEM_STATE_REFACCIONES = 'Refacciones para operaciones';
  static SYSTEM_STATE_SEMINUEVOS = 'Seminuevos';
  static SYSTEM_STATE_REMANUFACTURADO = 'Remanufacturado';
  static SYSTEM_STATE_PRINCIPAL = 'Principal';

  static normalizeSystemStatus(val) {
    if (!val) return PrinterModel.SYSTEM_STATE_PRINCIPAL;
    const str = String(val).trim().toLowerCase();
    if (str.includes('refaccion') || str.includes('operacion')) {
      return PrinterModel.SYSTEM_STATE_REFACCIONES;
    }
    if (str.includes('seminuevo') || str.includes('semi nuevo')) {
      return PrinterModel.SYSTEM_STATE_SEMINUEVOS;
    }
    if (str.includes('reman')) {
      return PrinterModel.SYSTEM_STATE_REMANUFACTURADO;
    }
    if (str.includes('principal')) {
      return PrinterModel.SYSTEM_STATE_PRINCIPAL;
    }
    return PrinterModel.SYSTEM_STATE_PRINCIPAL;
  }

  constructor({
    id = null,
    serial = '',
    material = '',
    checklistId = null,
    isScanned = false,
    scannedAt = null,
    warehouseName = 'Almacén 1',
    warehouseRow = 'Fila 1',
    warehouseSpace = '',
    status = PrinterModel.STATUS_DISPONIBLE,
    systemStatus = PrinterModel.SYSTEM_STATE_PRINCIPAL,
    checklistName = '',
    checklistFolio = '',
    internalNumber = null,
    assignedAt = null
  }) {
    this.id = id;
    this.serial = (serial || '').trim().toUpperCase();
    this.material = (material || 'Modelo Genérico').trim();
    this.checklistId = checklistId;
    this.isScanned = Boolean(isScanned);
    this.scannedAt = scannedAt;
    this.warehouseName = warehouseName || 'Almacén 1';
    this.warehouseRow = warehouseRow || 'Fila 1';
    this.warehouseSpace = (warehouseSpace || '').trim();
    this.status = status || PrinterModel.STATUS_DISPONIBLE;
    this.systemStatus = PrinterModel.normalizeSystemStatus(systemStatus);
    this.checklistName = checklistName || 'Inventario General';
    this.checklistFolio = (checklistFolio && String(checklistFolio).trim() !== '' && String(checklistFolio).toLowerCase() !== 'sin folio')
      ? String(checklistFolio).trim()
      : 'SIN FOLIO';
    this.internalNumber = internalNumber !== null && internalNumber !== undefined && internalNumber !== ''
      ? (isNaN(Number(internalNumber)) ? String(internalNumber) : Number(internalNumber))
      : null;
    this.assignedAt = assignedAt;
  }

  get isAssigned() {
    return Boolean(this.warehouseSpace) || this.isScanned;
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

  /**
   * Clases visuales de Tailwind según el Estado de Proceso / Sistema
   * 1. Refacciones para operaciones: Amarillo
   * 2. Seminuevos: Naranja
   * 3. Remanufacturado: Verde
   * 4. Principal: Azul
   */
  getSystemStatusBadge() {
    switch (this.systemStatus) {
      case PrinterModel.SYSTEM_STATE_REFACCIONES:
        return {
          label: PrinterModel.SYSTEM_STATE_REFACCIONES,
          badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
          dotColor: 'bg-amber-500',
          textColor: 'text-amber-900'
        };
      case PrinterModel.SYSTEM_STATE_SEMINUEVOS:
        return {
          label: PrinterModel.SYSTEM_STATE_SEMINUEVOS,
          badgeClass: 'bg-orange-100 text-orange-950 border-orange-300 font-bold',
          dotColor: 'bg-orange-500',
          textColor: 'text-orange-950'
        };
      case PrinterModel.SYSTEM_STATE_REMANUFACTURADO:
        return {
          label: PrinterModel.SYSTEM_STATE_REMANUFACTURADO,
          badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-300 font-bold',
          dotColor: 'bg-emerald-500',
          textColor: 'text-emerald-950'
        };
      case PrinterModel.SYSTEM_STATE_PRINCIPAL:
      default:
        return {
          label: PrinterModel.SYSTEM_STATE_PRINCIPAL,
          badgeClass: 'bg-blue-100 text-blue-950 border-blue-300 font-bold',
          dotColor: 'bg-blue-500',
          textColor: 'text-blue-950'
        };
    }
  }

  static encodePrinterStatusWithSystemState(status = 'DISPONIBLE', systemStatus = 'Principal') {
    const base = ['CONSULTA', 'BAJA', 'DISPONIBLE'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase()
      : 'DISPONIBLE';
    const sys = PrinterModel.normalizeSystemStatus(systemStatus);
    return `${base}|${sys}`;
  }

  static decodePrinterStatusAndSystemState(rawPrinterStatus, rawSystemStatus, meta = {}) {
    let baseStatus = PrinterModel.STATUS_DISPONIBLE;
    let sysStatus = rawSystemStatus || meta.systemStatus || PrinterModel.SYSTEM_STATE_PRINCIPAL;

    if (rawPrinterStatus && String(rawPrinterStatus).includes('|')) {
      const [partStatus, partSys] = String(rawPrinterStatus).split('|');
      baseStatus = partStatus || PrinterModel.STATUS_DISPONIBLE;
      if (!rawSystemStatus && partSys) {
        sysStatus = partSys;
      }
    } else if (rawPrinterStatus) {
      const upper = String(rawPrinterStatus).trim().toUpperCase();
      if (['DISPONIBLE', 'CONSULTA', 'BAJA'].includes(upper)) {
        baseStatus = upper;
      } else {
        sysStatus = rawPrinterStatus;
      }
    } else if (meta.status) {
      baseStatus = meta.status;
    }

    return {
      status: baseStatus,
      systemStatus: PrinterModel.normalizeSystemStatus(sysStatus)
    };
  }

  static fromDb(dbItem, checklistInfo = {}, metadataCache = {}) {
    const serial = (dbItem.serial_number || dbItem.serial || '').toUpperCase();
    const meta = metadataCache[serial] || {};
    const warehouseName = dbItem.warehouse_name || meta.warehouseName || 'Almacén 1';
    const warehouseSpace = dbItem.warehouse_space || meta.warehouseSpace || '';
    const assignedAt = dbItem.assigned_at || meta.assignedAt || null;
    const internalNum = dbItem.internal_number !== undefined && dbItem.internal_number !== null
      ? dbItem.internal_number
      : (meta.internalNumber ?? null);

    const decoded = PrinterModel.decodePrinterStatusAndSystemState(
      dbItem.printer_status,
      dbItem.system_status,
      meta
    );

    return new PrinterModel({
      id: dbItem.id,
      serial: serial,
      material: dbItem.material_model || dbItem.material || 'Sin Modelo',
      checklistId: dbItem.checklist_id || checklistInfo?.id || null,
      isScanned: dbItem.is_scanned ?? meta.isScanned ?? false,
      scannedAt: dbItem.scanned_at || null,
      warehouseName: warehouseName,
      warehouseRow: dbItem.warehouse_row || meta.warehouseRow || 'Fila 1',
      warehouseSpace: warehouseSpace,
      status: decoded.status,
      systemStatus: decoded.systemStatus,
      checklistName: checklistInfo?.name || meta.checklistName || 'Inventario General',
      checklistFolio: checklistInfo?.folio || meta.checklistFolio || 'SIN FOLIO',
      internalNumber: internalNum,
      assignedAt: assignedAt
    });
  }
}
