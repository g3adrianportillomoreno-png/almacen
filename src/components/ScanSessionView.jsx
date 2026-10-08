import { useState, useMemo } from 'react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import CameraScanner from './CameraScanner';
import { InventoryController } from '../controllers/InventoryController';

export default function ScanSessionView({ 
  batchDetails, 
  onCompleteTrailer, 
  onLogUnexpected, 
  onFinishSession, 
  onForceFinish,
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Fila 5', 'Fila 6'],
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  allPrinters = []
}) {
  // Modal de Asignación Física "¿Dónde la quieres colocar?"
  const [pendingAssignmentItem, setPendingAssignmentItem] = useState(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState(availableWarehouses[0] || 'Almacén 1');
  const [selectedRow, setSelectedRow] = useState(availableRows[0] || 'Fila 1');
  const [spaceInput, setSpaceInput] = useState('');
  const [equipmentNumberInput, setEquipmentNumberInput] = useState('');
  
  // Agregar Almacén o Fila personalizada en el modal
  const [showCustomWarehouse, setShowCustomWarehouse] = useState(false);
  const [customWarehouseInput, setCustomWarehouseInput] = useState('');
  const [showCustomRow, setShowCustomRow] = useState(false);
  const [customRowInput, setCustomRowInput] = useState('');

  // Estados de escaneo
  const [isSearching, setIsSearching] = useState(false);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const [lastScannedMaterial, setLastScannedMaterial] = useState('');
  const [lastAssignedLocation, setLastAssignedLocation] = useState('');
  const [useCamera, setUseCamera] = useState(false);

  // Totales
  const total = batchDetails.expectedSeries.length;
  const escaneados = batchDetails.completed.length;
  const faltantes = total - escaneados;
  const isFinished = batchDetails.status === 'completed' || escaneados === total;

  // Lista única de almacenes disponibles
  const warehouseOptions = useMemo(() => {
    const set = new Set(availableWarehouses);
    allPrinters.forEach(p => {
      if (p.warehouseName && p.warehouseName.trim()) set.add(p.warehouseName.trim());
    });
    return Array.from(set).sort();
  }, [availableWarehouses, allPrinters]);

  // Lista única de filas disponibles
  const rowOptions = useMemo(() => {
    const set = new Set(availableRows);
    allPrinters.forEach(p => {
      if (p.warehouseRow && p.warehouseRow.trim() && p.warehouseRow !== 'Sin Asignar') {
        set.add(p.warehouseRow.trim());
      }
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [availableRows, allPrinters]);

  // Validación de Colisión de Espacio: No permitir repetir el mismo espacio en la misma fila del almacén
  const collisionOccupant = useMemo(() => {
    if (!pendingAssignmentItem) return null;
    const targetSpace = (spaceInput || '').trim().toLowerCase();
    const targetRow = (selectedRow || '').trim().toLowerCase();
    const targetWh = (selectedWarehouse || '').trim().toLowerCase();

    if (!targetSpace || targetSpace === 'general' || !targetRow) return null;

    return allPrinters.find(p => {
      if (p.serial === pendingAssignmentItem.rawCode) return false;
      const pSpace = (p.warehouseSpace || '').trim().toLowerCase();
      const pRow = (p.warehouseRow || '').trim().toLowerCase();
      const pWh = (p.warehouseName || '').trim().toLowerCase();

      return pSpace === targetSpace && pRow === targetRow && pWh === targetWh;
    });
  }, [pendingAssignmentItem, spaceInput, selectedRow, selectedWarehouse, allPrinters]);

  // Proceso al escanear con pistola lectora o cámara
  const processScan = (scannedCode) => {
    if (scannedCode.trim() === '' || isFinished) return;

    const code = scannedCode.trim().toUpperCase();
    setLastScanned(code);
    setIsSearching(true);
    setSearchSuccess(false);
    setSearchError(false);
    setUseCamera(false);
    
    setTimeout(() => {
      setIsSearching(false);
      
      const expectedItem = batchDetails.expectedSeries.find(item => item.serial === code);
      const isAlreadyDone = batchDetails.completed.includes(code);

      if (isAlreadyDone) {
        setLastScanned('');
        return;
      }

      if (expectedItem) {
        // Abrir ventana modal preguntando: "¿Dónde la quieres colocar?"
        setPendingAssignmentItem({ item: expectedItem, rawCode: code });
        setSelectedWarehouse(expectedItem.warehouseName || warehouseOptions[0] || 'Almacén 1');
        setSelectedRow(expectedItem.warehouseRow && expectedItem.warehouseRow !== 'Sin Asignar' ? expectedItem.warehouseRow : (rowOptions[0] || 'Fila 1'));
        setSpaceInput(expectedItem.warehouseSpace || '');
        setEquipmentNumberInput(expectedItem.internalNumber ? String(expectedItem.internalNumber) : '');
        setShowCustomWarehouse(false);
        setShowCustomRow(false);
        setCustomWarehouseInput('');
        setCustomRowInput('');
      } else {
        setSearchError(true);
        onLogUnexpected(code);
        setTimeout(() => {
          setSearchError(false);
          setLastScanned('');
        }, 2000); 
      }
    }, 400); 
  };

  useBarcodeScanner(processScan);

  // Confirmar y guardar asignación física desde la ventana modal
  const handleConfirmAssignment = () => {
    if (!pendingAssignmentItem) return;

    if (collisionOccupant) {
      alert(`¡Espacio ocupado! El espacio "${spaceInput}" en la ${selectedRow} (${selectedWarehouse}) ya está ocupado por la serie ${collisionOccupant.serial}. Por favor elige otro espacio.`);
      return;
    }

    const spaceFinal = spaceInput.trim() || 'General';
    const internalFinal = equipmentNumberInput.trim() !== '' ? equipmentNumberInput.trim() : null;

    setLastScannedMaterial(pendingAssignmentItem.item.material);
    setLastAssignedLocation(`${selectedWarehouse} → ${selectedRow} [${spaceFinal}]`);
    setSearchSuccess(true);
    
    onCompleteTrailer(pendingAssignmentItem.rawCode, {
      warehouseName: selectedWarehouse,
      warehouseRow: selectedRow,
      warehouseSpace: spaceFinal,
      internalNumber: internalFinal
    });
    
    setPendingAssignmentItem(null);
    setSpaceInput('');
    setEquipmentNumberInput('');

    setTimeout(() => {
      setSearchSuccess(false);
      setLastScanned('');
    }, 2500);
  };

  // VISTA AL COMPLETAR EL CHECKLIST
  if (isFinished) {
    const faltantesList = batchDetails.expectedSeries.filter(item => !batchDetails.completed.includes(item.serial));
    
    return (
      <div className="flex flex-col gap-6 w-full animate-fade-in max-w-4xl mx-auto pb-12">
        <section className="bg-emerald-50/70 border border-emerald-200 p-8 rounded-2xl shadow-xs text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-xs">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <div>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-3 py-1 rounded-full uppercase border border-emerald-200">
              {batchDetails.folio}
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-emerald-900 mt-2">Recepción de Checklist Completada</h2>
            <p className="text-emerald-700 text-sm font-medium">{batchDetails.cleanName || batchDetails.name}</p>
          </div>
        </section>

        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200">
          <h3 className="text-base font-bold text-slate-800 mb-5 border-b border-slate-100 pb-3">Resumen de Recepción y Ubicación Física</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-semibold text-emerald-800 mb-3 flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                Equipos Recibidos y Acomodados ({batchDetails.completed.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {batchDetails.expectedSeries.filter(item => batchDetails.completed.includes(item.serial)).map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        {item.internalNumber ? (
                          <span className="bg-slate-700 text-white font-bold text-[11px] px-2 py-0.5 rounded-md">
                            #{item.internalNumber}
                          </span>
                        ) : (
                          <span className="bg-purple-100 text-purple-700 font-bold text-[10px] px-1.5 py-0.5 rounded">
                            Nuevo
                          </span>
                        )}
                        <span className="font-mono font-bold text-slate-800">{item.serial}</span>
                      </div>
                      <span className="text-slate-500 text-[11px] block mt-0.5">{item.material}</span>
                    </div>
                    <span className="bg-white text-blue-700 font-medium text-xs px-2.5 py-1 rounded-lg border border-blue-200">
                      {item.warehouseRow || 'Almacén'} {item.warehouseSpace ? `(${item.warehouseSpace})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {faltantesList.length > 0 && (
              <div>
                <h4 className="font-semibold text-amber-700 mb-3 flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  Equipos Faltantes ({faltantesList.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {faltantesList.map((item, idx) => (
                    <div key={idx} className="bg-amber-50/60 p-2.5 rounded-lg border border-amber-200 flex justify-between">
                      <span className="font-mono font-semibold text-slate-800">{item.serial}</span>
                      <span className="text-slate-500">{item.material}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {batchDetails.unexpectedLogs && batchDetails.unexpectedLogs.length > 0 && (
              <div>
                <h4 className="font-semibold text-rose-700 mb-3 flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  Lecturas Fuera de Lista ({batchDetails.unexpectedLogs.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {batchDetails.unexpectedLogs.map((item, idx) => (
                    <div key={idx} className="bg-rose-50/60 p-2.5 rounded-lg border border-rose-200">
                      <span className="font-mono font-semibold text-rose-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            <button 
              type="button"
              onClick={() => InventoryController.exportChecklistReportToExcel(batchDetails)}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-xs text-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Descargar Reporte del Checklist (Excel)
            </button>
            <button 
              type="button"
              onClick={onFinishSession} 
              className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-xs text-sm"
            >
              Cerrar e Ir al Inventario
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-fade-in pb-12">
      {/* Tarjeta de Encabezado del Checklist */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="bg-red-50 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-md uppercase border border-red-200">
              {batchDetails.folio}
            </span>
            <h2 className="text-lg font-bold text-slate-800">{batchDetails.cleanName || batchDetails.name}</h2>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Recepción en proceso. Al escanear cada serie, podrás asignarle su Almacén, Fila y Espacio.
          </p>
        </div>

        <div className="flex gap-3 text-xs font-medium">
          <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-center min-w-[60px]">
            <span className="text-slate-400 text-[10px] block uppercase">Total</span>
            <span className="text-base font-bold text-slate-700">{total}</span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-center min-w-[60px]">
            <span className="text-emerald-700 text-[10px] block uppercase">Listos</span>
            <span className="text-base font-bold text-emerald-700">{escaneados}</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-center min-w-[60px]">
            <span className="text-rose-600 text-[10px] block uppercase">Faltan</span>
            <span className="text-base font-bold text-rose-700">{faltantes}</span>
          </div>
        </div>
      </div>

      {/* Barra de progreso del Checklist */}
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div 
          className="bg-red-600 h-2 rounded-full transition-all duration-500" 
          style={{ width: `${(escaneados / total) * 100}%` }}
        ></div>
      </div>

      {/* ÁREA CENTRAL DE DISPARO / ESCANEO (LIMPIA, SIN BARRA DE FILAS SUPERIOR) */}
      <section className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200 flex flex-col items-center justify-center text-center min-h-[300px]">
        {isSearching ? (
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <div className="w-12 h-12 border-2 border-slate-200 border-t-red-600 rounded-full animate-spin"></div>
            <p className="text-base font-semibold text-slate-600">Procesando serie: <span className="text-red-600 font-bold">{lastScanned}</span>...</p>
          </div>
        ) : searchSuccess ? (
          <div className="flex flex-col items-center gap-2 animate-fade-in">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shadow-xs mb-1">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p className="text-lg font-bold text-emerald-800">¡Registrado y Acomodado!</p>
            <p className="text-slate-800 font-mono text-base font-bold">{lastScanned}</p>
            <div className="flex flex-wrap gap-2 items-center justify-center mt-1">
              {lastScannedMaterial && (
                <span className="text-xs font-medium bg-slate-50 px-2.5 py-1 rounded-md text-slate-600 border border-slate-200">
                  Modelo: {lastScannedMaterial}
                </span>
              )}
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-200">
                {lastAssignedLocation}
              </span>
            </div>
          </div>
        ) : searchError ? (
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border-2 border-rose-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </div>
            <p className="text-lg font-bold text-rose-700">¡Fuera de Lista!</p>
            <p className="text-rose-600 font-mono text-sm">{lastScanned}</p>
          </div>
        ) : useCamera ? (
          <CameraScanner 
            expectedSeries={batchDetails.expectedSeries} 
            onScan={processScan} 
            onCancel={() => setUseCamera(false)} 
          />
        ) : (
          <div className="w-full max-w-md flex flex-col items-center gap-5">
            <div className="bg-red-50 p-4 rounded-full text-red-600">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center flex flex-col items-center gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">Listo para escanear</p>
                <p className="text-xs text-slate-500 mt-1">
                  Dispara la pistola lectora de código de barras a la serie de la máquina
                </p>
                <p className="text-[11px] text-blue-600 font-medium mt-1">
                  Al detectar la máquina, se abrirá la ventana para elegir Almacén, Fila y Espacio
                </p>
              </div>
              
              <span className="text-slate-400 text-xs font-normal">— O —</span>

              <button 
                onClick={() => setUseCamera(true)}
                className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 px-5 rounded-xl flex items-center gap-2.5 transition-colors shadow-xs w-full justify-center text-xs"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Leer con la Cámara del Celular (Zoom y Linterna)
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ACCIONES INFERIORES */}
      <div className="flex flex-wrap justify-between items-center gap-2 px-1">
        <button onClick={onFinishSession} className="text-slate-600 hover:text-slate-900 font-medium transition-colors text-xs flex items-center gap-1">
          &larr; Volver al Menú
        </button>
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => InventoryController.exportChecklistReportToExcel(batchDetails)}
            className="text-emerald-700 hover:text-emerald-800 font-semibold transition-colors text-xs border border-emerald-300 hover:border-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-50/50 shadow-2xs flex items-center gap-1.5"
            title="Descargar reporte con las impresoras escaneadas, faltantes y errores en Excel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Descargar Reporte del Checklist (Excel)
          </button>
          {faltantes > 0 && (
            <button onClick={onForceFinish} className="text-rose-600 hover:text-rose-700 font-medium transition-colors text-xs border border-rose-200 hover:border-rose-300 px-3 py-1.5 rounded-lg bg-white shadow-2xs">
              Finalizar Lote Incompleto
            </button>
          )}
        </div>
      </div>

      {/* VENTANA MODAL: ¿DÓNDE LA QUIERES COLOCAR? (ALMACÉN, FILA, ESPACIO CON DETECCIÓN DE COLISIÓN) */}
      {pendingAssignmentItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl relative overflow-y-auto max-h-[90vh] border border-slate-200">
            <button 
              onClick={() => {
                setPendingAssignmentItem(null);
                setSearchSuccess(false);
                setLastScanned('');
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition text-sm p-1"
            >
              ✕
            </button>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Equipo Escaneado
              </span>
              <h3 className="text-xl font-bold text-slate-900 mt-1">¿Dónde la quieres colocar?</h3>
              <p className="text-xs font-medium text-slate-500">
                Selecciona Almacén, Fila y escribe el Espacio donde se acomodará físicamente.
              </p>
            </div>
            
            {/* INFORMACIÓN DEL EQUIPO DETECTADO */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 my-4">
              <div className="flex justify-between mb-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Clave (Modelo):</span>
                <span className="font-bold text-slate-800 text-sm truncate max-w-[200px] text-right">
                  {pendingAssignmentItem.item.material}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Número de Serie:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{pendingAssignmentItem.item.serial}</span>
              </div>
            </div>

            {/* FORMULARIO: ALMACÉN, FILA, ESPACIO */}
            <div className="space-y-3.5">
              {/* ALMACÉN */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                    Almacén:
                  </label>
                  {!showCustomWarehouse ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(true)}
                      className="text-[11px] text-blue-600 hover:underline font-medium"
                    >
                      + Nuevo Almacén
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
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-red-500 outline-none"
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
                      placeholder="Ej: Alpha, Beta, Almacén Central..."
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
                      className="bg-slate-800 text-white font-medium text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* FILA */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                    Fila:
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
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-red-500 outline-none"
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
                      placeholder="Ej: 20, 19, 22, Fila 10..."
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
                      className="bg-slate-800 text-white font-medium text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* ESPACIO */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase tracking-wide">
                  Espacio en la Fila:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: 19 D, 3 I, 14 D, 12, 11..."
                  value={spaceInput}
                  onChange={(e) => setSpaceInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 uppercase focus:border-red-500 outline-none"
                />
              </div>

              {/* NÚMERO DE EQUIPO (OPCIONAL SI ES NUEVO) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase tracking-wide">
                  Número de Equipo (Opcional si es nuevo):
                </label>
                <input
                  type="text"
                  placeholder="Ej: 2535 (o dejar en blanco si aún no tiene)"
                  value={equipmentNumberInput}
                  onChange={(e) => setEquipmentNumberInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:border-red-500 outline-none"
                />
              </div>
            </div>

            {/* ALERTA DE COLISIÓN DE ESPACIO EN LA MISMA FILA */}
            {collisionOccupant && (
              <div className="mt-3 bg-rose-50 border-2 border-rose-400 rounded-2xl p-3 text-xs text-rose-900 animate-pulse flex items-start gap-2.5">
                <svg className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-bold text-rose-900">
                    ¡Espacio Ocupado! No se puede repetir en la misma fila.
                  </p>
                  <p className="text-rose-700 mt-0.5 text-[11px]">
                    El espacio <strong className="underline">"{spaceInput}"</strong> en <strong className="font-semibold">{selectedRow}</strong> ({selectedWarehouse}) ya está ocupado por la serie <strong className="font-mono">{collisionOccupant.serial}</strong> ({collisionOccupant.material || 'N/A'}).
                  </p>
                  <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                    Ingresa otro espacio diferente para continuar.
                  </p>
                </div>
              </div>
            )}

            {/* BOTÓN CONFIRMAR Y GUARDAR */}
            <button 
              type="button"
              disabled={Boolean(collisionOccupant)}
              onClick={handleConfirmAssignment}
              className={`w-full mt-5 font-bold py-3 rounded-xl transition shadow-xs flex items-center justify-center gap-2 text-xs ${
                collisionOccupant
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              Confirmar y Colocar Equipo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
