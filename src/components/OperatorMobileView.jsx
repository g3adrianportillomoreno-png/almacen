import { useState, useMemo, useRef, useEffect } from 'react';
import CameraScanner from './CameraScanner.jsx';
import useBarcodeScanner from '../hooks/useBarcodeScanner.js';
import { InventoryController } from '../controllers/InventoryController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';

export default function OperatorMobileView({
  batches = [],
  onCompleteTrailer,
  onAssignmentSaved,
  onRequestAdminView,
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4']
}) {
  // Pestaña activa del operador: 'reading' (Lectura libre / Ubicar) o 'checklists' (Lotes)
  const [operatorTab, setOperatorTab] = useState('reading');
  
  // Lote activo si el operador eligió un checklist
  const [activeChecklistId, setActiveChecklistId] = useState(null);

  // Estados de escaneo y búsqueda
  const [scanInput, setScanInput] = useState('');
  const [activePrinter, setActivePrinter] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [searchTableQuery, setSearchTableQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [notFoundSerial, setNotFoundSerial] = useState('');

  // Formulario táctil de colocación física
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

  // Checklists reales de recepción (excluyendo maestro)
  const receptionBatches = useMemo(() => {
    return batches.filter(b => !b.isMaster);
  }, [batches]);

  const activeChecklist = useMemo(() => {
    return receptionBatches.find(b => b.id === activeChecklistId);
  }, [receptionBatches, activeChecklistId]);

  // Todas las impresoras esperadas del sistema
  const allSystemPrinters = useMemo(() => {
    return InventoryController.extractAllExpectedPrinters(batches);
  }, [batches]);

  // Impresoras ya ubicadas (para validar colisión)
  const placedPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(batches);
  }, [batches]);

  // Equipos sin ubicación física asignada
  const unassignedPrinters = useMemo(() => {
    return allSystemPrinters.filter(p => 
      !p.warehouseSpace || 
      !p.warehouseRow || 
      p.warehouseRow === 'Sin Asignar' || 
      p.warehouseSpace.trim() === ''
    );
  }, [allSystemPrinters]);

  // Opciones de almacén
  const warehouseOptions = useMemo(() => {
    const set = new Set(availableWarehouses);
    allSystemPrinters.forEach(p => {
      if (p.warehouseName && p.warehouseName.trim()) set.add(p.warehouseName.trim());
    });
    return Array.from(set).sort();
  }, [availableWarehouses, allSystemPrinters]);

  // Opciones de fila
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

  // Detección de colisión en tiempo real
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

  // Seleccionar equipo para asignarle ubicación
  const handleSelectPrinter = (printer) => {
    setActivePrinter(printer);
    setSelectedWarehouse(printer.warehouseName || warehouseOptions[0] || 'Almacén 1');
    setSelectedRow(printer.warehouseRow && printer.warehouseRow !== 'Sin Asignar' ? printer.warehouseRow : (rowOptions[0] || 'Fila 1'));
    setSpaceInput(printer.warehouseSpace || '');
    setInternalNumberInput(printer.internalNumber ? String(printer.internalNumber) : '');
    setNotFoundSerial('');
    setSuccessMessage('');
  };

  // Procesar código leído por pistola o escáner
  const handleProcessScan = (rawCode) => {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) return;

    setNotFoundSerial('');
    setSuccessMessage('');

    // Si estamos en un checklist específico
    if (activeChecklist) {
      const matchInBatch = activeChecklist.expectedSeries.find(
        p => String(p.serial).trim().toUpperCase() === code
      );
      if (matchInBatch) {
        handleSelectPrinter({
          ...matchInBatch,
          batchId: activeChecklist.id,
          batchFolio: activeChecklist.folio
        });
      } else {
        setNotFoundSerial(code);
      }
    } else {
      // Búsqueda global en todo el sistema
      const match = allSystemPrinters.find(p => String(p.serial).trim().toUpperCase() === code);
      if (match) {
        handleSelectPrinter(match);
      } else {
        setNotFoundSerial(code);
      }
    }
    setScanInput('');
  };

  // Escáner de pistola física global
  useBarcodeScanner((scanned) => {
    if (!isCameraActive && !activePrinter) {
      handleProcessScan(scanned);
    }
  });

  // Confirmar y guardar asignación física
  const handleSaveLocation = async (e) => {
    if (e) e.preventDefault();
    if (!activePrinter || collisionOccupant) return;

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

      // 2. Si venía de un checklist activo, registrar escaneo en el lote
      if (activeChecklist && onCompleteTrailer) {
        await onCompleteTrailer(activePrinter.serial, {
          warehouseName: selectedWarehouse,
          warehouseRow: selectedRow,
          warehouseSpace: spaceVal,
          internalNumber: numEquipo,
          batchId: activeChecklist.id
        }, activeChecklist.id);
      }

      // 3. Asegurar que la fila y el almacén existan en el plano del mapa
      if (selectedRow) {
        WarehouseMapController.ensureRowExists(selectedRow, selectedWarehouse);
      }

      setSuccessMessage(`✓ Serie ${activePrinter.serial} guardada en ${selectedWarehouse} → ${selectedRow} [${spaceVal}]`);

      // Sugerir siguiente espacio si es numérico (ej: 19 D -> 20 D o 1 -> 2)
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

      // Devolver foco al input
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 150);
    } catch (err) {
      alert("Error guardando ubicación: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtrado de equipos pendientes
  const filteredUnassigned = useMemo(() => {
    if (!searchTableQuery.trim()) return unassignedPrinters;
    const q = searchTableQuery.toLowerCase();
    return unassignedPrinters.filter(p => 
      (p.serial && p.serial.toLowerCase().includes(q)) ||
      (p.material && p.material.toLowerCase().includes(q))
    );
  }, [unassignedPrinters, searchTableQuery]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none max-w-lg mx-auto pb-10">
      
      {/* BARRA SUPERIOR MÓVIL DEL OPERADOR */}
      <header className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-600 text-white font-black text-sm flex items-center justify-center">
            CDM
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide leading-none">MODO OPERADOR</h1>
            <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              En Línea (Tiempo Real)
            </span>
          </div>
        </div>

        {/* Botón para regresar a modo oficina (con contraseña) */}
        <button
          onClick={onRequestAdminView}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
          title="Acceso protegido a pantalla de oficina / computadora"
        >
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Oficina</span>
        </button>
      </header>

      {/* MENSAJE DE ÉXITO O ALERTA */}
      {successMessage && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold text-center animate-fade-in flex items-center justify-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
          <span>{successMessage}</span>
        </div>
      )}

      {notFoundSerial && (
        <div className="bg-rose-600 text-white px-4 py-2.5 text-xs font-bold text-center animate-fade-in flex items-center justify-center gap-2">
          <span>⚠️ Serie "{notFoundSerial}" no encontrada en la lista actual.</span>
        </div>
      )}

      {/* SELECTOR DE MODO: LECTURA LIBRE O CHECKLISTS */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800">
        <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-2xl border border-slate-800">
          <button
            onClick={() => {
              setOperatorTab('reading');
              setActiveChecklistId(null);
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              operatorTab === 'reading' && !activeChecklistId
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            <span>Lectura / Acomodo</span>
          </button>

          <button
            onClick={() => setOperatorTab('checklists')}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              operatorTab === 'checklists' || activeChecklistId
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>Checklists ({receptionBatches.length})</span>
          </button>
        </div>
      </div>

      {/* ÁREA DE CAPTURA PRINCIPAL */}
      <div className="p-4 flex-1 flex flex-col gap-4">

        {/* SI ESTÁ VIENDO LA LISTA DE CHECKLISTS */}
        {operatorTab === 'checklists' && !activeChecklistId && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-slate-200">Selecciona el Checklist a Recibir:</h2>
            {receptionBatches.length === 0 ? (
              <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 text-center">
                <p className="text-xs text-slate-400">No hay checklists de recepción de equipos nuevos pendientes.</p>
              </div>
            ) : (
              receptionBatches.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => setActiveChecklistId(batch.id)}
                  className="bg-slate-800 hover:bg-slate-700/80 p-4 rounded-2xl border border-slate-700 text-left transition flex items-center justify-between active:scale-98"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-red-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-lg">
                        {batch.folio}
                      </span>
                      <span className="text-xs font-bold text-white">{batch.cleanName || batch.name}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {batch.completed.length} de {batch.totalCount} escaneados
                    </span>
                  </div>
                  <span className="text-red-400 text-sm font-bold">&rarr;</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* SI TIENE UN CHECKLIST ACTIVO O ESTÁ EN LECTURA DIRECTA */}
        {(operatorTab === 'reading' || activeChecklistId) && (
          <div className="flex flex-col gap-4">
            
            {/* ENCABEZADO DE MODO ACTIVO */}
            {activeChecklist && (
              <div className="bg-red-950/70 border border-red-700/60 p-3 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-red-300 uppercase tracking-wide">Checklist Activo:</span>
                  <p className="text-xs font-black text-white">{activeChecklist.folio} - {activeChecklist.cleanName}</p>
                  <p className="text-[10px] text-emerald-400 font-bold mt-0.5">
                    {activeChecklist.completed.length} de {activeChecklist.totalCount} completados
                  </p>
                </div>
                <button
                  onClick={() => setActiveChecklistId(null)}
                  className="text-[11px] text-slate-300 bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700 font-medium"
                >
                  Cambiar
                </button>
              </div>
            )}

            {/* BARRA DE ENTRADA CON PISTOLA O TECLADO */}
            <div className="bg-slate-800/80 p-4 rounded-3xl border border-slate-700 flex flex-col gap-3 shadow-lg">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wide flex items-center justify-between">
                <span>Disparar Pistola / Escanear Serie:</span>
                <span className="text-[10px] text-emerald-400 font-normal">Listo para lectura</span>
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  ref={scanInputRef}
                  autoFocus
                  placeholder="ESCANEAR O ESCRIBIR SERIE..."
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessScan(scanInput);
                    }
                  }}
                  className="flex-1 bg-slate-950 border-2 border-slate-600 focus:border-emerald-500 rounded-2xl px-4 py-3 text-sm font-mono font-bold text-white uppercase outline-none placeholder-slate-500"
                />
                <button
                  onClick={() => handleProcessScan(scanInput)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 rounded-2xl text-xs transition active:scale-95"
                >
                  OK
                </button>
              </div>

              {/* BOTÓN GRANDE PARA ABRIR CÁMARA DEL CELULAR */}
              <button
                type="button"
                onClick={() => setIsCameraActive(!isCameraActive)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 text-xs transition border border-slate-600 shadow-sm active:scale-98"
              >
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{isCameraActive ? 'Cerrar Cámara' : 'Abrir Cámara con Linterna y Zoom'}</span>
              </button>
            </div>

            {/* VISOR DE CÁMARA */}
            {isCameraActive && (
              <div className="bg-slate-950 p-2 rounded-3xl border border-slate-700 overflow-hidden">
                <CameraScanner
                  onScan={(code) => {
                    setIsCameraActive(false);
                    handleProcessScan(code);
                  }}
                  onCancel={() => setIsCameraActive(false)}
                />
              </div>
            )}

            {/* LISTA RÁPIDA DE EQUIPOS PENDIENTES DE UBICACIÓN */}
            {!activeChecklist && (
              <div className="bg-slate-800/60 rounded-3xl p-4 border border-slate-700/80 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Pendientes de Ubicación ({unassignedPrinters.length})
                    </h3>
                    <p className="text-[10px] text-slate-400">Toca cualquier equipo para asignarlo</p>
                  </div>
                  <div className="w-36">
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={searchTableQuery}
                      onChange={(e) => setSearchTableQuery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-white placeholder-slate-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredUnassigned.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No hay equipos pendientes con ese filtro.</p>
                  ) : (
                    filteredUnassigned.slice(0, 30).map((printer) => (
                      <div
                        key={printer.id || printer.serial}
                        onClick={() => handleSelectPrinter(printer)}
                        className="bg-slate-900 hover:bg-slate-750 p-3 rounded-2xl border border-slate-700/80 flex items-center justify-between cursor-pointer active:scale-98 transition"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white text-xs">{printer.serial}</span>
                            {printer.internalNumber && (
                              <span className="bg-slate-800 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                #{printer.internalNumber}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block mt-0.5">{printer.material}</span>
                        </div>
                        <span className="text-emerald-400 text-xs font-bold bg-emerald-950/80 px-2.5 py-1 rounded-xl border border-emerald-800">
                          Ubicar &rarr;
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* VENTANA MODAL MÓVIL: ¿DÓNDE LA QUIERES COLOCAR? */}
      {activePrinter && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-slate-900 text-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 border border-slate-700 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            
            {/* CABECERA DEL MODAL */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  Equipo Detectado
                </span>
                <h3 className="text-lg font-black text-white mt-1">¿Dónde la quieres colocar?</h3>
              </div>
              <button
                onClick={() => setActivePrinter(null)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* DETALLES DE LA SERIE Y MODELO */}
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Modelo:</span>
                <span className="text-sm font-bold text-white">{activePrinter.material || 'N/A'}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Número de Serie:</span>
                <span className="text-sm font-mono font-bold text-emerald-400">{activePrinter.serial}</span>
              </div>
            </div>

            {/* FORMULARIO TÁCTIL */}
            <form onSubmit={handleSaveLocation} className="space-y-3.5">
              
              {/* ALMACÉN */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-bold text-slate-300 uppercase">Almacén:</label>
                  {!showCustomWarehouse ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(true)}
                      className="text-[11px] text-blue-400 hover:underline font-bold"
                    >
                      + Nuevo Almacén
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(false)}
                      className="text-[11px] text-slate-400"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {!showCustomWarehouse ? (
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
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
                      className="flex-1 bg-slate-950 border border-blue-400 rounded-xl px-3 py-2 text-xs font-bold text-white uppercase outline-none"
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
                      className="bg-slate-700 text-white font-bold text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* FILA */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-bold text-slate-300 uppercase">Fila:</label>
                  {!showCustomRow ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomRow(true)}
                      className="text-[11px] text-blue-400 hover:underline font-bold"
                    >
                      + Nueva Fila
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomRow(false)}
                      className="text-[11px] text-slate-400"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {!showCustomRow ? (
                  <select
                    value={selectedRow}
                    onChange={(e) => setSelectedRow(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
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
                      className="flex-1 bg-slate-950 border border-blue-400 rounded-xl px-3 py-2 text-xs font-bold text-white uppercase outline-none"
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
                      className="bg-slate-700 text-white font-bold text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* ESPACIO (CAMPO PRINCIPAL) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1 uppercase">
                  Espacio en la Fila (Ej: 19 D, 3 I, 14 D, 12...):
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="EJ: 19 D, 3 I, 14 D..."
                  value={spaceInput}
                  onChange={(e) => setSpaceInput(e.target.value)}
                  className="w-full bg-slate-950 border-2 border-emerald-500 rounded-2xl px-4 py-3 text-base font-bold text-white uppercase tracking-wider outline-none"
                />
              </div>

              {/* NÚMERO DE EQUIPO OPCIONAL */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1 uppercase">
                  Número de Equipo (opcional si es nuevo):
                </label>
                <input
                  type="text"
                  placeholder="Ej: 2535 (o en blanco)"
                  value={internalNumberInput}
                  onChange={(e) => setInternalNumberInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none"
                />
              </div>

              {/* ALERTA DE COLISIÓN DE ESPACIO EN TIEMPO REAL */}
              {collisionOccupant && (
                <div className="bg-rose-950/80 border-2 border-rose-600 rounded-2xl p-3 text-xs text-rose-200 animate-pulse">
                  <p className="font-bold text-rose-300 text-sm">¡Espacio Ocupado!</p>
                  <p className="mt-1">
                    El espacio <strong className="underline">"{spaceInput}"</strong> en <strong className="text-white">{selectedRow}</strong> ({selectedWarehouse}) ya está ocupado por la serie <strong className="font-mono text-white">{collisionOccupant.serial}</strong>.
                  </p>
                  <p className="mt-1 font-bold text-rose-300">Por favor escribe otro espacio.</p>
                </div>
              )}

              {/* BOTÓN GRANDE PARA CONFIRMAR */}
              <button
                type="submit"
                disabled={isSubmitting || Boolean(collisionOccupant)}
                className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wide transition shadow-lg flex items-center justify-center gap-2 mt-2 ${
                  collisionOccupant
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-98'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>{isSubmitting ? 'Guardando...' : 'Confirmar y Colocar Equipo'}</span>
              </button>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
