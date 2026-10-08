import { useState, useMemo, useRef, useEffect } from 'react';
import { InventoryController } from '../controllers/InventoryController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import CameraScanner from './CameraScanner.jsx';
import useBarcodeScanner from '../hooks/useBarcodeScanner.js';

export default function EquipmentReadingView({ 
  checklists = [], 
  onAssignmentSaved,
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4'],
  onBackToHome
}) {
  const [scanInput, setScanInput] = useState('');
  const [activePrinter, setActivePrinter] = useState(null);
  const [notFoundQuery, setNotFoundQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [searchTableQuery, setSearchTableQuery] = useState('');

  // Formulario de asignación
  const [selectedWarehouse, setSelectedWarehouse] = useState(availableWarehouses[0] || 'Almacén 1');
  const [selectedRow, setSelectedRow] = useState(availableRows[0] || 'Fila 1');
  const [spaceInput, setSpaceInput] = useState('');
  const [internalNumberInput, setInternalNumberInput] = useState('');
  const [showCustomWarehouse, setShowCustomWarehouse] = useState(false);
  const [customWarehouseInput, setCustomWarehouseInput] = useState('');
  const [showCustomRow, setShowCustomRow] = useState(false);
  const [customRowInput, setCustomRowInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scanInputRef = useRef(null);

  // Extraer absolutamente todas las impresoras del sistema (incluyendo checklists y maestro)
  const allSystemPrinters = useMemo(() => {
    return InventoryController.extractAllExpectedPrinters(checklists);
  }, [checklists]);

  // Lista de impresoras que YA están ubicadas en el almacén (para validar colisión)
  const placedPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(checklists);
  }, [checklists]);

  // Equipos que NO tienen ubicación asignada
  const unassignedPrinters = useMemo(() => {
    return allSystemPrinters.filter(p => 
      !p.warehouseSpace || 
      !p.warehouseRow || 
      p.warehouseRow === 'Sin Asignar' || 
      p.warehouseSpace.trim() === ''
    );
  }, [allSystemPrinters]);

  // Contadores
  const stats = useMemo(() => {
    const total = allSystemPrinters.length;
    const sinUbicacion = unassignedPrinters.length;
    const conUbicacion = total - sinUbicacion;
    return { total, conUbicacion, sinUbicacion };
  }, [allSystemPrinters, unassignedPrinters]);

  // Opciones de almacenes
  const warehouseOptions = useMemo(() => {
    const set = new Set(availableWarehouses);
    allSystemPrinters.forEach(p => {
      if (p.warehouseName && p.warehouseName.trim()) set.add(p.warehouseName.trim());
    });
    return Array.from(set).sort();
  }, [availableWarehouses, allSystemPrinters]);

  // Opciones de filas
  const rowOptions = useMemo(() => {
    const set = new Set(availableRows);
    allSystemPrinters.forEach(p => {
      if (p.warehouseRow && p.warehouseRow.trim() && p.warehouseRow !== 'Sin Asignar') {
        set.add(p.warehouseRow.trim());
      }
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [availableRows, allSystemPrinters]);

  // Validación de Colisión en tiempo real
  const collisionOccupant = useMemo(() => {
    if (!activePrinter) return null;
    const targetSpace = (spaceInput || '').trim().toLowerCase();
    const targetRow = (selectedRow || '').trim().toLowerCase();
    const targetWh = (selectedWarehouse || '').trim().toLowerCase();

    if (!targetSpace || targetSpace === 'general' || !targetRow) return null;

    return placedPrinters.find(p => {
      if (p.serial === activePrinter.serial) return false;
      const pSpace = (p.warehouseSpace || '').trim().toLowerCase();
      const pRow = (p.warehouseRow || '').trim().toLowerCase();
      const pWh = (p.warehouseName || '').trim().toLowerCase();

      return pSpace === targetSpace && pRow === targetRow && pWh === targetWh;
    });
  }, [activePrinter, spaceInput, selectedRow, selectedWarehouse, placedPrinters]);

  // Abrir equipo seleccionado para asignarle ubicación
  const handleSelectPrinterForLocation = (printer) => {
    setActivePrinter(printer);
    setSelectedWarehouse(printer.warehouseName || warehouseOptions[0] || 'Almacén 1');
    setSelectedRow(printer.warehouseRow && printer.warehouseRow !== 'Sin Asignar' ? printer.warehouseRow : (rowOptions[0] || 'Fila 1'));
    setSpaceInput(printer.warehouseSpace || '');
    setInternalNumberInput(printer.internalNumber !== null && printer.internalNumber !== undefined ? String(printer.internalNumber) : '');
    setSuccessMessage('');
    setNotFoundQuery('');
    setShowCustomWarehouse(false);
    setShowCustomRow(false);
  };

  // Manejo de búsqueda por pistola / lector / código
  const handleSearchSerial = (rawSerial) => {
    const serial = (rawSerial || '').trim().toUpperCase();
    if (!serial) return;

    setSuccessMessage('');
    setNotFoundQuery('');

    // Buscar en todas las impresoras del sistema
    const match = allSystemPrinters.find(p => p.serial === serial);

    if (match) {
      handleSelectPrinterForLocation(match);
    } else {
      setActivePrinter(null);
      setNotFoundQuery(serial);
    }
    setScanInput('');
  };

  // Escáner de pistola global
  useBarcodeScanner((scanned) => {
    if (!isCameraActive && !activePrinter) {
      handleSearchSerial(scanned);
    }
  });

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSerial(scanInput);
    }
  };

  const handleCameraScan = (scannedCode) => {
    setIsCameraActive(false);
    handleSearchSerial(scannedCode);
  };

  // Guardar asignación física
  const handleSaveAssignment = async (e) => {
    e.preventDefault();
    if (!activePrinter) return;

    if (collisionOccupant) {
      alert(`¡Espacio ocupado! El espacio "${spaceInput}" en la ${selectedRow} (${selectedWarehouse}) ya está ocupado por la serie ${collisionOccupant.serial}. Elige otro espacio.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const spaceVal = spaceInput.trim() || 'General';
      const numEquipo = internalNumberInput.trim() !== '' ? internalNumberInput.trim() : activePrinter.internalNumber;

      // 1. Asignar en inventario
      await InventoryController.assignPrinter(activePrinter.serial, {
        warehouseName: selectedWarehouse,
        warehouseRow: selectedRow,
        warehouseSpace: spaceVal,
        internalNumber: numEquipo
      });

      // 2. Opción A: Asegurar que la fila se cree y dibuje en el plano del mapa si es nueva
      if (selectedRow) {
        WarehouseMapController.ensureRowExists(selectedRow, selectedWarehouse);
      }

      setSuccessMessage(`¡Equipo serie ${activePrinter.serial} (${activePrinter.material || 'Equipo'}) guardado exitosamente en ${selectedWarehouse} → ${selectedRow} → ${spaceVal}!`);
      
      // Sugerir siguiente espacio si es numérico (ej: 1 -> 2)
      const numMatch = spaceVal.match(/^.*?(\d+)$/);
      if (numMatch) {
        const nextNum = parseInt(numMatch[1], 10) + 1;
        const prefix = spaceVal.replace(/\d+$/, '');
        setSpaceInput(`${prefix}${nextNum}`);
      } else {
        setSpaceInput('');
      }

      setActivePrinter(null);
      if (onAssignmentSaved) onAssignmentSaved();

      // Devolver foco al input para la siguiente pistola
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 100);
    } catch (err) {
      alert("Error al guardar asignación: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtrado de la tabla de equipos sin ubicación
  const filteredUnassigned = useMemo(() => {
    const q = searchTableQuery.trim().toLowerCase();
    if (!q) return unassignedPrinters;
    return unassignedPrinters.filter(p => 
      (p.serial || '').toLowerCase().includes(q) ||
      (p.material || '').toLowerCase().includes(q) ||
      String(p.internalNumber || '').toLowerCase().includes(q) ||
      (p.batchFolio || '').toLowerCase().includes(q)
    );
  }, [unassignedPrinters, searchTableQuery]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto animate-fade-in pb-16">
      
      {/* CABECERA SUPERIOR */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-xs shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Lectura y Acomodo de Equipos
              </h2>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                Asignación de Ubicación
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Escanea con pistola o cámara para asignarle Almacén, Fila y Espacio a las máquinas que aún no tienen ubicación física.
            </p>
          </div>
        </div>

        {onBackToHome && (
          <button
            type="button"
            onClick={onBackToHome}
            className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-4 py-2 rounded-xl transition flex items-center gap-1.5 shrink-0"
          >
            <span>&larr; Volver a Recepciones</span>
          </button>
        )}
      </div>

      {/* MÉTRICAS */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs text-center">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total en Sistema
          </span>
          <span className="text-xl font-black text-slate-800 mt-0.5 block">
            {stats.total}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs text-center bg-emerald-50/30">
          <span className="block text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
            Con Ubicación Física
          </span>
          <span className="text-xl font-black text-emerald-700 mt-0.5 block">
            {stats.conUbicacion}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-amber-300 shadow-xs text-center bg-amber-50/50">
          <span className="block text-[11px] font-semibold text-amber-900 uppercase tracking-wider">
            Faltan por Ubicar
          </span>
          <span className="text-xl font-black text-amber-900 mt-0.5 block">
            {stats.sinUbicacion}
          </span>
        </div>
      </div>

      {/* CÁMARA CON ZOOM Y LINTERNA */}
      {isCameraActive && (
        <div className="bg-slate-900 rounded-3xl p-4 shadow-md flex flex-col items-center animate-fade-in">
          <div className="flex justify-between items-center w-full max-w-sm mb-2 text-xs text-slate-300">
            <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Cámara Activa (Zoom y Linterna)
            </span>
            <button 
              onClick={() => setIsCameraActive(false)}
              className="text-slate-400 hover:text-white underline text-xs"
            >
              Cerrar Cámara
            </button>
          </div>

          <CameraScanner
            expectedSeries={allSystemPrinters}
            onScan={handleCameraScan}
            onCancel={() => setIsCameraActive(false)}
          />
        </div>
      )}

      {/* ÁREA DE DISPARO DE PISTOLA O BÚSQUEDA */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              ref={scanInputRef}
              type="text"
              autoFocus
              className="w-full border border-slate-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 rounded-xl px-4 py-3 pl-10 text-xs uppercase font-bold text-slate-800 placeholder-slate-400"
              placeholder="DISPARA LA PISTOLA AQUÍ O ESCRIBE EL NÚMERO DE SERIE..."
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>

          <button
            type="button"
            onClick={() => handleSearchSerial(scanInput)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-5 py-3 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
          >
            <span>Buscar Serie</span>
          </button>

          {!isCameraActive && (
            <button
              type="button"
              onClick={() => setIsCameraActive(true)}
              className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
              title="Leer serie con la cámara del teléfono"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
              <span>Usar Cámara</span>
            </button>
          )}
        </div>

        {/* Mensaje de éxito */}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 animate-fade-in shadow-2xs">
            <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Alerta de serie no encontrada */}
        {notFoundQuery && (
          <div className="bg-rose-50 border border-rose-300 text-rose-900 p-3.5 rounded-xl text-xs font-medium flex items-center gap-2 animate-fade-in">
            <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <span className="font-bold">La serie "{notFoundQuery}" no coincide con ningún documento registrado.</span>
              <span className="block text-[11px] text-rose-700 mt-0.5">Verifica el código o sube el checklist o excel correspondiente.</span>
            </div>
          </div>
        )}
      </div>

      {/* VENTANA MODAL / FORMULARIO: ¿DÓNDE LA QUIERES COLOCAR? */}
      {activePrinter && (
        <form onSubmit={handleSaveAssignment} className="bg-white border-2 border-emerald-500 rounded-3xl p-6 shadow-xl flex flex-col gap-4 animate-fade-in">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-sm font-bold text-slate-800">¿Dónde la quieres colocar?</span>
            </div>
            <button 
              type="button" 
              onClick={() => setActivePrinter(null)}
              className="text-xs text-slate-400 hover:text-slate-600 p-1 font-bold"
            >
              ✕ Cerrar
            </button>
          </div>

          {/* DATOS DEL EQUIPO DETECTADO */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">1. Clave (Modelo):</span>
              <span className="font-bold text-slate-800 text-sm truncate block mt-0.5">{activePrinter.material || 'MODELO'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">2. Número de Serie:</span>
              <span className="font-mono font-bold text-slate-900 text-sm truncate block mt-0.5">{activePrinter.serial}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">3. Número de Equipo:</span>
              <span className="font-bold text-emerald-800 text-sm truncate block mt-0.5">
                {activePrinter.internalNumber ? `#${activePrinter.internalNumber}` : 'Sin Asignar (Nuevo)'}
              </span>
              {activePrinter.batchFolio && (
                <span className="text-[10px] text-slate-400 block mt-0.5 truncate">{activePrinter.batchFolio}</span>
              )}
            </div>
          </div>

          {/* ASIGNACIÓN FÍSICA: ALMACÉN, FILA Y ESPACIO */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* ALMACÉN */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-700 uppercase">
                  4. Almacén:
                </label>
                {!showCustomWarehouse ? (
                  <button
                    type="button"
                    onClick={() => setShowCustomWarehouse(true)}
                    className="text-[11px] text-blue-600 hover:underline font-medium"
                  >
                    + Nuevo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCustomWarehouse(false)}
                    className="text-[11px] text-slate-400 hover:underline"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {!showCustomWarehouse ? (
                <select
                  value={selectedWarehouse}
                  onChange={(e) => setSelectedWarehouse(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-emerald-600 outline-none"
                >
                  {warehouseOptions.map((w, idx) => (
                    <option key={idx} value={w}>{w}</option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Ej: Alpha, Beta..."
                    value={customWarehouseInput}
                    onChange={(e) => setCustomWarehouseInput(e.target.value)}
                    className="flex-1 bg-slate-50 border border-blue-400 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customWarehouseInput.trim()) {
                        setSelectedWarehouse(customWarehouseInput.trim());
                        setShowCustomWarehouse(false);
                        setCustomWarehouseInput('');
                      }
                    }}
                    className="bg-slate-800 text-white font-medium text-xs px-2.5 py-1.5 rounded-xl"
                  >
                    OK
                  </button>
                </div>
              )}
            </div>

            {/* FILA */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-700 uppercase">
                  5. Fila:
                </label>
                {!showCustomRow ? (
                  <button
                    type="button"
                    onClick={() => setShowCustomRow(true)}
                    className="text-[11px] text-blue-600 hover:underline font-medium"
                  >
                    + Nueva Fila
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCustomRow(false)}
                    className="text-[11px] text-slate-400 hover:underline"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {!showCustomRow ? (
                <select
                  value={selectedRow}
                  onChange={(e) => setSelectedRow(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-emerald-600 outline-none"
                >
                  {rowOptions.map((r, idx) => (
                    <option key={idx} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Ej: 20, 19, 22..."
                    value={customRowInput}
                    onChange={(e) => setCustomRowInput(e.target.value)}
                    className="flex-1 bg-slate-50 border border-blue-400 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customRowInput.trim()) {
                        setSelectedRow(customRowInput.trim());
                        setShowCustomRow(false);
                        setCustomRowInput('');
                      }
                    }}
                    className="bg-slate-800 text-white font-medium text-xs px-2.5 py-1.5 rounded-xl"
                  >
                    OK
                  </button>
                </div>
              )}
            </div>

            {/* ESPACIO */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase">
                6. Espacio:
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Ej: 19 D, 3 I, 14 D, 12, 11..."
                value={spaceInput}
                onChange={(e) => setSpaceInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 uppercase focus:border-emerald-600 outline-none"
              />
            </div>
          </div>

          {/* EDITAR NÚMERO DE EQUIPO OPCIONAL */}
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
            <label className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
              Número de Equipo (opcional si es nuevo):
            </label>
            <input
              type="text"
              placeholder="Ej: 2535..."
              value={internalNumberInput}
              onChange={(e) => setInternalNumberInput(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 w-36 uppercase focus:border-emerald-600 outline-none"
            />
          </div>

          {/* ALERTA DE COLISIÓN DE ESPACIO EN LA MISMA FILA */}
          {collisionOccupant && (
            <div className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-3 text-xs text-rose-900 animate-pulse flex items-start gap-2.5">
              <svg className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-bold text-rose-900">
                  ¡Espacio Ocupado! No se puede repetir en la misma fila.
                </p>
                <p className="text-rose-700 mt-0.5 text-[11px]">
                  El espacio <strong className="underline font-bold">"{spaceInput}"</strong> en <strong className="font-bold">{selectedRow}</strong> ({selectedWarehouse}) ya está ocupado por la serie <strong className="font-mono">{collisionOccupant.serial}</strong> ({collisionOccupant.material || 'N/A'}).
                </p>
                <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                  Escribe otro espacio diferente para continuar.
                </p>
              </div>
            </div>
          )}

          {/* BOTONES */}
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setActivePrinter(null)}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(collisionOccupant)}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white transition shadow-sm flex items-center gap-2 ${
                collisionOccupant
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              {isSubmitting ? 'Guardando...' : 'Confirmar y Asignar Ubicación'}
            </button>
          </div>
        </form>
      )}

      {/* TABLA DE EQUIPOS PENDIENTES DE UBICACIÓN */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              Equipos Pendientes de Ubicación ({unassignedPrinters.length})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Haz clic en "Asignar Ubicación" en cualquier equipo o usa la pistola lectora arriba.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Filtrar pendientes..."
              value={searchTableQuery}
              onChange={(e) => setSearchTableQuery(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-1.5 pl-8 text-xs font-medium text-slate-800"
            />
            <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-b border-slate-200">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Clave (Modelo)</th>
                <th className="py-2.5 px-3">Número de Serie</th>
                <th className="py-2.5 px-3">No. Equipo</th>
                <th className="py-2.5 px-3">Origen / Lote</th>
                <th className="py-2.5 px-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnassigned.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    {unassignedPrinters.length === 0 ? (
                      <p className="font-semibold text-emerald-700">¡Excelente! Todos los equipos registrados tienen ubicación asignada.</p>
                    ) : (
                      <p>No se encontraron equipos con ese filtro de búsqueda.</p>
                    )}
                  </td>
                </tr>
              ) : (
                filteredUnassigned.slice(0, 50).map((printer, idx) => (
                  <tr key={printer.id || printer.serial} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-800">{printer.material || 'MODELO'}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{printer.serial}</td>
                    <td className="py-2.5 px-3">
                      {printer.internalNumber ? (
                        <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          #{printer.internalNumber}
                        </span>
                      ) : (
                        <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                          Nuevo
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                      {printer.batchFolio || printer.batchName || 'Inventario'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleSelectPrinterForLocation(printer)}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-3 py-1 rounded-lg text-[11px] transition shadow-2xs"
                      >
                        Asignar Ubicación &rarr;
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredUnassigned.length > 50 && (
          <div className="p-2.5 text-center bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">
            Mostrando los primeros 50 equipos pendientes de {filteredUnassigned.length}. Usa el buscador para filtrar más específicamente.
          </div>
        )}
      </div>

    </div>
  );
}

