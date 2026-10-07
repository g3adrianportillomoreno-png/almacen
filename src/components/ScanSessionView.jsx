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
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Fila 5', 'Fila 6']
}) {
  const [selectedRow, setSelectedRow] = useState('Fila 1');
  const [customRowInput, setCustomRowInput] = useState('');
  const [showCustomRow, setShowCustomRow] = useState(false);

  // Calcular el siguiente número de impresora sugerido
  const nextSuggestedNumber = useMemo(() => {
    const nums = (batchDetails.expectedSeries || [])
      .map(s => Number(s.internalNumber))
      .filter(n => !isNaN(n) && n > 0);
    return nums.length > 0 ? Math.max(...nums) + 1 : (batchDetails.completed.length + 1);
  }, [batchDetails]);

  // Número de inventario que el operador asignará a la impresora al escanear
  const [assignedNumber, setAssignedNumber] = useState(nextSuggestedNumber);
  const [autoIncrementNumber, setAutoIncrementNumber] = useState(true);

  const [isSearching, setIsSearching] = useState(false);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const [lastScannedMaterial, setLastScannedMaterial] = useState('');
  const [lastAssignedRow, setLastAssignedRow] = useState('');
  const [lastAssignedNum, setLastAssignedNum] = useState(null);
  
  const [useCamera, setUseCamera] = useState(false);

  const total = batchDetails.expectedSeries.length;
  const escaneados = batchDetails.completed.length;
  const faltantes = total - escaneados;
  
  const isFinished = batchDetails.status === 'completed' || escaneados === total;

  const handleAddCustomRow = (e) => {
    e.preventDefault();
    if (customRowInput.trim()) {
      const formatted = customRowInput.trim();
      setSelectedRow(formatted);
      setShowCustomRow(false);
      setCustomRowInput('');
    }
  };

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
        const numToAssign = Number(assignedNumber) || 1;
        setLastScannedMaterial(expectedItem.material);
        setLastAssignedRow(selectedRow);
        setLastAssignedNum(numToAssign);
        setSearchSuccess(true);

        setTimeout(() => {
          // Envía serie, Fila y Número de inventario asignado a la impresora
          onCompleteTrailer(code, selectedRow, numToAssign); 
          if (autoIncrementNumber) {
            setAssignedNumber(prev => (Number(prev) || 0) + 1);
          }
          setSearchSuccess(false);
          setLastScanned('');
        }, 1200);
      } else {
        setSearchError(true);
        onLogUnexpected(code);
        setTimeout(() => {
          setSearchError(false);
          setLastScanned('');
        }, 2000); 
      }
    }, 600); 
  };

  useBarcodeScanner(processScan);

  if (isFinished) {
    const faltantesList = batchDetails.expectedSeries.filter(item => !batchDetails.completed.includes(item.serial));
    
    return (
      <div className="flex flex-col gap-6 w-full animate-fade-in max-w-4xl mx-auto">
        <section className="bg-emerald-50/70 border border-emerald-200 p-8 rounded-2xl shadow-xs text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-xs">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <div>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-3 py-1 rounded-full uppercase border border-emerald-200">
              {batchDetails.folio}
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-emerald-900 mt-2">Recepción Completada</h2>
            <p className="text-emerald-700 text-sm font-medium">{batchDetails.name}</p>
          </div>
        </section>

        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200">
          <h3 className="text-base font-bold text-slate-800 mb-5 border-b border-slate-100 pb-3">Resumen de Recepción y Ubicación</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-semibold text-emerald-800 mb-3 flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                Equipos Acomodados en Almacén ({batchDetails.completed.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {batchDetails.expectedSeries.filter(item => batchDetails.completed.includes(item.serial)).map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="bg-slate-700 text-white font-bold text-[11px] px-2 py-0.5 rounded-md">
                          #{item.internalNumber || (idx + 1)}
                        </span>
                        <span className="font-mono font-bold text-slate-800">{item.serial}</span>
                      </div>
                      <span className="text-slate-500 text-[11px] block mt-0.5">{item.material}</span>
                    </div>
                    <span className="bg-white text-blue-700 font-medium text-xs px-2.5 py-1 rounded-lg border border-blue-200">
                      {item.warehouseRow || selectedRow}
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
              Cerrar e Ir al Inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-fade-in">
      {/* Tarjeta de encabezado del Lote */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="bg-red-50 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-md uppercase border border-red-200">
              {batchDetails.folio}
            </span>
            <h2 className="text-lg font-bold text-slate-800">{batchDetails.cleanName || batchDetails.name}</h2>
          </div>
          <p className="text-slate-500 text-xs mt-1">Fecha de registro: <span className="font-medium text-slate-700">{batchDetails.date}</span></p>
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

      {/* SELECTOR DE FILA Y NÚMERO DE INVENTARIO PARA LA IMPRESORA */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Selector de Fila */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-200 text-slate-600 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide block">
              Fila en Almacén:
            </label>
            <div className="flex items-center gap-2 mt-1">
              {!showCustomRow ? (
                <>
                  <select
                    value={selectedRow}
                    onChange={(e) => setSelectedRow(e.target.value)}
                    className="bg-white border border-slate-300 text-slate-800 font-semibold text-xs rounded-xl px-3 py-1.5 focus:border-blue-500 shadow-2xs"
                  >
                    {availableRows.map((r, i) => (
                      <option key={i} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCustomRow(true)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium px-2.5 py-1.5 rounded-xl text-xs transition"
                  >
                    + Fila
                  </button>
                </>
              ) : (
                <form onSubmit={handleAddCustomRow} className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Nombre Fila..."
                    value={customRowInput}
                    onChange={(e) => setCustomRowInput(e.target.value)}
                    className="bg-white border border-blue-400 text-slate-800 font-medium text-xs rounded-xl px-2 py-1.5 uppercase"
                  />
                  <button type="submit" className="bg-slate-800 text-white font-medium text-xs px-2.5 py-1.5 rounded-xl">
                    OK
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setShowCustomRow(false)} 
                    className="bg-slate-200 text-slate-700 font-medium text-xs px-2 py-1.5 rounded-xl"
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* NÚMERO INTERNO ASIGNADO A LA IMPRESORA (PARA QUE SE REFLEJE EN EL MAPA EJ: 1-80) */}
        <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="w-8 h-8 bg-red-50 text-red-600 font-bold rounded-lg flex items-center justify-center text-sm shrink-0">
            #
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide block">
              Número a Asignar al Equipo:
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                min="1"
                value={assignedNumber}
                onChange={(e) => setAssignedNumber(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 border border-slate-300 focus:border-red-500 rounded-lg px-2 py-0.5 text-center font-bold text-sm text-slate-800"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoIncrementNumber}
                  onChange={(e) => setAutoIncrementNumber(e.target.checked)}
                  className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5"
                />
                Auto (+1)
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div 
          className="bg-red-600 h-2 rounded-full transition-all duration-500" 
          style={{ width: `${(escaneados / total) * 100}%` }}
        ></div>
      </div>

      {/* ÁREA CENTRAL DE ESCANEO */}
      <section className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200 flex flex-col items-center justify-center text-center min-h-[280px]">
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
            <p className="text-lg font-bold text-emerald-800">¡Registrado Correctamente!</p>
            <p className="text-slate-800 font-mono text-base font-bold">{lastScanned}</p>
            <div className="flex flex-wrap gap-2 items-center justify-center mt-1">
              <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200">
                Número: #{lastAssignedNum}
              </span>
              {lastScannedMaterial && (
                <span className="text-xs font-medium bg-slate-50 px-2.5 py-1 rounded-md text-slate-600 border border-slate-200">
                  Modelo: {lastScannedMaterial}
                </span>
              )}
              <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-200">
                Ubicación: {lastAssignedRow}
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
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4"></path></svg>
            </div>
            <div className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center flex flex-col items-center gap-3">
              <div>
                <p className="text-sm font-bold text-slate-700 uppercase tracking-wide">Listo para escanear</p>
                <p className="text-xs text-slate-500 mt-0.5">Dispara la pistola lectora en cualquier momento</p>
                <p className="text-xs font-medium text-slate-600 mt-1">
                  Se asignará a <span className="font-semibold text-slate-800">{selectedRow}</span> con número <strong className="text-red-700">#{assignedNumber}</strong>
                </p>
              </div>
              
              <span className="text-slate-400 text-xs font-normal">— O —</span>

              <button 
                onClick={() => setUseCamera(true)}
                className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 px-5 rounded-xl flex items-center gap-2.5 transition-colors shadow-xs w-full justify-center text-xs"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Leer con la Cámara del Celular
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-between items-center gap-2 px-1">
        <button onClick={onFinishSession} className="text-slate-600 hover:text-slate-900 font-medium transition-colors text-xs flex items-center gap-1">
          &larr; Volver al Inicio
        </button>
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => InventoryController.exportChecklistReportToExcel(batchDetails)}
            className="text-emerald-700 hover:text-emerald-800 font-medium transition-colors text-xs border border-emerald-300 hover:border-emerald-400 px-3 py-1 rounded-lg bg-emerald-50/50 shadow-2xs flex items-center gap-1.5"
            title="Descargar reporte con las impresoras escaneadas, faltantes y errores en Excel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Descargar Reporte (Excel)
          </button>
          {faltantes > 0 && (
            <button onClick={onForceFinish} className="text-rose-600 hover:text-rose-700 font-medium transition-colors text-xs border border-rose-200 hover:border-rose-300 px-3 py-1 rounded-lg bg-white shadow-2xs">
              Finalizar Lote Incompleto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
