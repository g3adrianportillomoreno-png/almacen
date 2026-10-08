/**
 * Modelo de Dominio: WarehouseMapModel
 * Gestiona múltiples almacenes (ej. Almacén 1, Almacén 2), el cambio de nombre del almacén ("Mapa"),
 * los rectángulos de cada fila, y el cálculo de rangos numéricos (ej. 1 - 80).
 */
export class WarehouseMapModel {
  static DEFAULT_ALM1_ROWS = [
    { id: 'alm1-fila-1', name: 'Fila 1', x: 20, y: 20, width: 190, height: 120 },
    { id: 'alm1-fila-2', name: 'Fila 2', x: 230, y: 20, width: 190, height: 120 },
    { id: 'alm1-fila-3', name: 'Fila 3', x: 20, y: 160, width: 190, height: 120 },
    { id: 'alm1-fila-4', name: 'Fila 4', x: 230, y: 160, width: 190, height: 120 }
  ];

  static DEFAULT_ALM2_ROWS = [
    { id: 'alm2-fila-1', name: 'Fila A', x: 20, y: 20, width: 190, height: 120 },
    { id: 'alm2-fila-2', name: 'Fila B', x: 230, y: 20, width: 190, height: 120 },
    { id: 'alm2-fila-3', name: 'Fila C', x: 20, y: 160, width: 190, height: 120 }
  ];

  static DEFAULT_WAREHOUSES = [
    { id: 'alm-1', name: 'Almacén 1', rows: WarehouseMapModel.DEFAULT_ALM1_ROWS },
    { id: 'alm-2', name: 'Almacén 2', rows: WarehouseMapModel.DEFAULT_ALM2_ROWS }
  ];

  constructor(data = {}) {
    // Si data es un array antiguo de filas directas, migrar a formato multi-almacén
    if (Array.isArray(data)) {
      this.warehouses = [
        { id: 'alm-1', name: 'Almacén 1', rows: data.length > 0 ? data : WarehouseMapModel.DEFAULT_ALM1_ROWS },
        { id: 'alm-2', name: 'Almacén 2', rows: WarehouseMapModel.DEFAULT_ALM2_ROWS }
      ];
      this.activeWarehouseId = 'alm-1';
    } else if (data.warehouses && Array.isArray(data.warehouses)) {
      this.warehouses = data.warehouses;
      this.activeWarehouseId = data.activeWarehouseId || this.warehouses[0]?.id || 'alm-1';
    } else {
      this.warehouses = WarehouseMapModel.DEFAULT_WAREHOUSES;
      this.activeWarehouseId = 'alm-1';
    }
  }

  /**
   * Obtiene el almacén activo actualmente
   */
  getActiveWarehouse() {
    return this.warehouses.find(w => w.id === this.activeWarehouseId) || this.warehouses[0];
  }

  /**
   * Obtiene las filas del almacén activo
   */
  get rows() {
    return this.getActiveWarehouse()?.rows || [];
  }

  /**
   * Cambia el almacén activo (ej. Almacén 1 -> Almacén 2)
   */
  setActiveWarehouse(warehouseId) {
    return new WarehouseMapModel({
      warehouses: this.warehouses,
      activeWarehouseId: warehouseId
    });
  }

  /**
   * Cambia el nombre del almacén activo o mapa (ej: "Almacén 1" -> "Nave Principal")
   */
  renameWarehouse(warehouseId, newName) {
    const cleanName = (newName || '').trim();
    if (!cleanName) return this;
    const updated = this.warehouses.map(w => 
      w.id === warehouseId ? { ...w, name: cleanName } : w
    );
    return new WarehouseMapModel({
      warehouses: updated,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Agrega un nuevo almacén (ej: "Almacén 3")
   */
  addWarehouse(customName = '') {
    const num = this.warehouses.length + 1;
    const name = customName.trim() || `Almacén ${num}`;
    const id = `alm-${Date.now()}`;
    const newWh = {
      id,
      name,
      rows: [
        { id: `${id}-fila-1`, name: 'Fila 1', x: 20, y: 20, width: 190, height: 120 }
      ]
    };
    return new WarehouseMapModel({
      warehouses: [...this.warehouses, newWh],
      activeWarehouseId: id
    });
  }

  /**
   * Obtiene todos los nombres de filas del almacén activo
   */
  getRowNames() {
    return this.rows.map(r => r.name);
  }

  /**
   * Obtiene todos los nombres únicos de filas registrados en todos los almacenes
   */
  getAllRowNames() {
    const set = new Set();
    this.warehouses.forEach(w => {
      (w.rows || []).forEach(r => {
        if (r.name && r.name.trim()) set.add(r.name.trim());
      });
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }

  /**
   * Elimina un almacén del mapa (solo si hay más de 1 almacén registrado)
   */
  removeWarehouse(warehouseId) {
    if (this.warehouses.length <= 1) return this;
    const updatedWarehouses = this.warehouses.filter(w => w.id !== warehouseId);
    const newActiveId = this.activeWarehouseId === warehouseId ? updatedWarehouses[0].id : this.activeWarehouseId;
    return new WarehouseMapModel({
      warehouses: updatedWarehouses,
      activeWarehouseId: newActiveId
    });
  }

  /**
   * Modifica el nombre de una Fila en el almacén activo
   */
  renameRow(id, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return this;
    const updatedWarehouses = this.warehouses.map(w => {
      if (w.id === this.activeWarehouseId) {
        return {
          ...w,
          rows: w.rows.map(r => r.id === id ? { ...r, name: trimmed } : r)
        };
      }
      return w;
    });
    return new WarehouseMapModel({
      warehouses: updatedWarehouses,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Agrega una nueva Fila compacta al almacén activo
   */
  addRow(customName = '') {
    const currentRows = this.rows;
    const nextNum = currentRows.length + 1;
    const name = customName.trim() || `Fila ${nextNum}`;
    const id = `fila-${Date.now()}`;

    const cols = 2;
    const index = currentRows.length;
    const rowIdx = Math.floor(index / cols);
    const colIdx = index % cols;

    const newRect = {
      id,
      name,
      x: 20 + colIdx * 210,
      y: 20 + rowIdx * 140,
      width: 190,
      height: 120
    };

    const updatedWarehouses = this.warehouses.map(w => {
      if (w.id === this.activeWarehouseId) {
        return {
          ...w,
          rows: [...w.rows, newRect]
        };
      }
      return w;
    });

    return new WarehouseMapModel({
      warehouses: updatedWarehouses,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Asegura que una fila exista en el almacén especificado (o en el activo).
   * Si el almacén no existe, lo crea automáticamente como una nueva pestaña en el plano del mapa.
   * Si la fila no existe en el almacén, crea automáticamente el cuadro gráfico y lo añade al plano.
   */
  ensureRowExists(rowName, warehouseNameOrId = null) {
    const cleanRowName = (rowName || '').trim();
    if (!cleanRowName) return this;

    const cleanWhName = (warehouseNameOrId || '').trim();
    let currentWarehouses = this.warehouses.map(w => ({
      ...w,
      rows: [...(w.rows || [])]
    }));

    let targetWh = null;
    let whCreated = false;

    if (cleanWhName) {
      targetWh = currentWarehouses.find(w => 
        w.id === cleanWhName || 
        w.name.trim().toLowerCase() === cleanWhName.toLowerCase()
      );
    }

    // Si se especificó un almacén y no existe en la lista de almacenes, crearlo dinámicamente como nueva pestaña
    if (!targetWh && cleanWhName) {
      const newWhId = `alm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      targetWh = {
        id: newWhId,
        name: cleanWhName,
        rows: []
      };
      currentWarehouses.push(targetWh);
      whCreated = true;
    }

    if (!targetWh) {
      targetWh = currentWarehouses.find(w => w.id === this.activeWarehouseId) || currentWarehouses[0];
    }
    if (!targetWh) return this;

    const rowNameLower = cleanRowName.toLowerCase();
    const alreadyExists = (targetWh.rows || []).some(r => 
      (r.name || '').trim().toLowerCase() === rowNameLower
    );

    if (alreadyExists && !whCreated) {
      return this;
    }

    if (!alreadyExists) {
      const currentRows = targetWh.rows || [];
      const id = `fila-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const cols = 2;
      const index = currentRows.length;
      const rowIdx = Math.floor(index / cols);
      const colIdx = index % cols;

      const newRect = {
        id,
        name: cleanRowName,
        x: 20 + colIdx * 210,
        y: 20 + rowIdx * 140,
        width: 190,
        height: 120
      };

      targetWh.rows.push(newRect);
    }

    return new WarehouseMapModel({
      warehouses: currentWarehouses,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Actualiza la posición de un rectángulo en el almacén activo
   */
  updateRowPosition(id, { x, y, width, height }) {
    const updatedWarehouses = this.warehouses.map(w => {
      if (w.id === this.activeWarehouseId) {
        return {
          ...w,
          rows: w.rows.map(r => {
            if (r.id === id) {
              return {
                ...r,
                x: x !== undefined ? Math.max(10, Math.round(x)) : r.x,
                y: y !== undefined ? Math.max(10, Math.round(y)) : r.y,
                width: width !== undefined ? Math.max(150, Math.round(width)) : (r.width || 190),
                height: height !== undefined ? Math.max(90, Math.round(height)) : (r.height || 120)
              };
            }
            return r;
          })
        };
      }
      return w;
    });

    return new WarehouseMapModel({
      warehouses: updatedWarehouses,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Elimina una fila del almacén activo
   */
  removeRow(id) {
    const updatedWarehouses = this.warehouses.map(w => {
      if (w.id === this.activeWarehouseId) {
        return {
          ...w,
          rows: w.rows.filter(r => r.id !== id)
        };
      }
      return w;
    });

    return new WarehouseMapModel({
      warehouses: updatedWarehouses,
      activeWarehouseId: this.activeWarehouseId
    });
  }

  /**
   * Calcula las métricas para una fila dada: Rango de Espacios asignados (ej: 1 D - 19 D o 1 - 20),
   * conteo de equipos y modelos presentes.
   */
  static calculateRowStats(rowName, allPrinters = [], warehouseName = null) {
    const normalize = str => (str || '').trim().toLowerCase();
    const targetRow = normalize(rowName);
    const targetWh = warehouseName ? normalize(warehouseName) : null;

    // Filtrar impresoras de esta fila (excluyendo las dadas de BAJA)
    const inRow = allPrinters.filter(p => {
      const rowMatches = normalize(p.warehouseRow) === targetRow;
      if (!rowMatches) return false;
      if (targetWh) {
        const pWh = normalize(p.warehouseName);
        return !pWh || pWh === targetWh;
      }
      return true;
    });

    const activeInRow = inRow.filter(p => !p.isBaja);
    const bajasInRow = inRow.filter(p => p.isBaja);
    const consultasInRow = inRow.filter(p => p.isConsulta);

    // Modelos únicos
    const modelsSet = new Set(activeInRow.map(p => p.material).filter(Boolean));
    const modelsList = Array.from(modelsSet);

    // Extraer espacios físicos asignados (ej: '19 D', '3 I', '14 D', '12', '11'...)
    const rawSpaces = activeInRow
      .map(p => (p.warehouseSpace || '').trim())
      .filter(s => s && s.toLowerCase() !== 'general' && s.toLowerCase() !== 'sin asignar');

    // Extraer números internos de equipo
    const rawNumbers = activeInRow
      .map(p => p.internalNumber)
      .filter(n => n !== null && n !== undefined && String(n).trim() !== '');

    let numberRangeText = 'Sin espacios';
    let spacesList = [];

    if (rawSpaces.length > 0) {
      // Ordenamiento natural de espacios asignados:
      // Agrupa numéricamente por el número presente en el texto (ej: "3 I" -> 3, "14 D" -> 14)
      const uniqueSpaces = Array.from(new Set(rawSpaces));
      spacesList = uniqueSpaces.sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10);
        const numB = parseInt(b.replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          if (numA !== numB) return numA - numB;
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        }
        if (!isNaN(numA)) return -1;
        if (!isNaN(numB)) return 1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });

      if (spacesList.length === 1) {
        numberRangeText = `${spacesList[0]}`;
      } else if (spacesList.length === 2) {
        numberRangeText = `${spacesList[0]} - ${spacesList[1]}`;
      } else {
        const minSpace = spacesList[0];
        const maxSpace = spacesList[spacesList.length - 1];
        numberRangeText = `${minSpace} - ${maxSpace}`;
      }
    } else if (rawNumbers.length > 0) {
      // Si aún no tienen espacio físico pero tienen número de equipo asignado
      const numericList = rawNumbers
        .map(n => Number(n))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

      if (numericList.length > 0) {
        const min = numericList[0];
        const max = numericList[numericList.length - 1];
        numberRangeText = min === max ? `#${min}` : `#${min} - #${max}`;
      } else {
        numberRangeText = rawNumbers.join(', ');
      }
    }

    return {
      rowName,
      totalCount: activeInRow.length,
      bajasCount: bajasInRow.length,
      consultasCount: consultasInRow.length,
      models: modelsList,
      numberRangeText, // Rango de espacios asignados (ej. 1 D - 19 D o 1 - 20)
      spacesList,
      printers: inRow
    };
  }

  toJSON() {
    return {
      warehouses: this.warehouses,
      activeWarehouseId: this.activeWarehouseId
    };
  }
}
