import { useState, useEffect } from 'react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import CameraScanner from './CameraScanner';
import { InventoryController } from '../controllers/InventoryController';
import { findSerialMatch } from '../utils/serialMatcher';
import { soundEffects, isSoundMuted, toggleSoundMute } from '../utils/soundEffects';

export default function ScanSessionView({ 
  batchDetails, 
  onCompleteTrailer, 
  onLogUnexpected, 
  onFinishSession, 
  onForceFinish
}) {
  const [soundMuted, setSoundMuted] = useState(() => isSoundMuted());

  // Estados de escaneo directo (solo verificar si está o no está)
  const [isSearching, setIsSearching] = useState(false);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [searchDuplicate, setSearchDuplicate] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const [lastScannedMaterial, setLastScannedMaterial] = useState('');
  const [useCamera, setUseCamera] = useState(false);
  const [manualInput, setManualInput] = useState('');

  // Totales
  const total = batchDetails.expectedSeries.length;
  const escaneados = batchDetails.completed.length;
  const faltantes = total - escaneados;
  const isFinished = batchDetails.status === 'completed' || (total > 0 && escaneados >= total);

  // Proceso inmediato al escanear con pistola lectora, cámara o teclado:
  // Solo verifica si está en la lista o no, sin pedir ubicación física.
  const processScan = (scannedCode) => {
    if (!scannedCode || scannedCode.trim() === '' || isFinished) return;

    const code = scannedCode.trim().toUpperCase();
    setLastScanned(code);
    setIsSearching(true);
    setSearchSuccess(false);
    setSearchDuplicate(false);
    setSearchError(false);
    setUseCamera(false);
    
    setTimeout(() => {
      setIsSearching(false);
      
      const expectedItem = findSerialMatch(code, batchDetails.expectedSeries);
      const isAlreadyDone = expectedItem 
        ? batchDetails.completed.includes(expectedItem.serial) 
        : batchDetails.completed.includes(code);

      if (isAlreadyDone) {
        soundEffects.playScanDuplicate();
        setSearchDuplicate(true);
        setLastScanned(expectedItem ? expectedItem.serial : code);
        setLastScannedMaterial(expectedItem ? expectedItem.material : '');
        setTimeout(() => {
          setSearchDuplicate(false);
          setLastScanned('');
        }, 1800);
        return;
      }

      if (expectedItem) {
        soundEffects.playScanSuccess();
        setLastScanned(expectedItem.serial);
        setLastScannedMaterial(expectedItem.material || 'SIN MODELO');
        setSearchSuccess(true);

        // Si con esta lectura se completó el checklist al 100%, reproducir fanfarria
        if ((batchDetails.completed.length + 1) >= batchDetails.expectedSeries.length) {
          setTimeout(() => {
            soundEffects.playChecklistCompleted();
          }, 500);
        }

        // Marcar directamente como presente en el checklist (sin pedir ubicación)
        onCompleteTrailer(expectedItem.serial, null);

        setTimeout(() => {
          setSearchSuccess(false);
          setLastScanned('');
        }, 1800);
      } else {
        soundEffects.playScanError();
        setSearchError(true);
        onLogUnexpected(code);
        setTimeout(() => {
          setSearchError(false);
          setLastScanned('');
        }, 2000); 
      }
    }, 150); 
  };

  useBarcodeScanner(processScan);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    processScan(manualInput);
    setManualInput('');
  };

  // Sonido de celebración si se ingresa a un checklist ya completado
  useEffect(() => {
    if (isFinished) {
      soundEffects.playChecklistCompleted();
    }
  }, [isFinished]);

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
            <h2 className="text-xl md:text-2xl font-bold text-emerald-900 mt-2">Verificación de Checklist Completada</h2>
            <p className="text-emerald-700 text-sm font-medium">{batchDetails.cleanName || batchDetails.name}</p>
          </div>
        </section>

        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200">
          <h3 className="text-base font-bold text-slate-800 mb-5 border-b border-slate-100 pb-3">Resumen de Verificación de Equipos</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-semibold text-emerald-800 mb-3 flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                Equipos Presentes / Verificados ({batchDetails.completed.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {batchDetails.expectedSeries.filter(item => batchDetails.completed.includes(item.serial)).map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{item.serial}</span>
                      </div>
                      <span className="text-slate-500 text-[11px] block mt-0.5">{item.material}</span>
                    </div>
                    <span className="bg-emerald-100 text-emerald-800 font-bold text-[11px] px-2.5 py-1 rounded-lg border border-emerald-200">
                      ✓ SÍ ESTÁ
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {faltantesList.length > 0 && (
              <div>
                <h4 className="font-semibold text-amber-700 mb-3 flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  Equipos Faltantes / No Escaneados ({faltantesList.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {faltantesList.map((item, idx) => (
                    <div key={idx} className="bg-amber-50/60 p-2.5 rounded-lg border border-amber-200 flex justify-between items-center">
                      <div>
                        <span className="font-mono font-semibold text-slate-800 block">{item.serial}</span>
                        <span className="text-slate-500 text-[11px]">{item.material}</span>
                      </div>
                      <span className="bg-amber-100 text-amber-800 font-bold text-[10px] px-2 py-0.5 rounded border border-amber-300">
                        FALTA
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {batchDetails.unexpectedLogs && batchDetails.unexpectedLogs.length > 0 && (
              <div>
                <h4 className="font-semibold text-rose-700 mb-3 flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  No están en la Lista ({batchDetails.unexpectedLogs.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {batchDetails.unexpectedLogs.map((item, idx) => (
                    <div key={idx} className="bg-rose-50/60 p-2.5 rounded-lg border border-rose-200 flex justify-between items-center">
                      <span className="font-mono font-semibold text-rose-700">{item}</span>
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">NO ESTÁ EN LISTA</span>
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
              Cerrar y Volver
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
            Escaneo rápido de recepción: verifica al instante si cada serie <strong className="text-slate-700">SÍ ESTÁ</strong> o <strong className="text-rose-600">NO ESTÁ</strong> en el checklist.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => setSoundMuted(toggleSoundMute())}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
              soundMuted
                ? 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
            }`}
            title={soundMuted ? 'Sonidos silenciados (clic para activar)' : 'Sonidos activos (clic para silenciar)'}
          >
            <span>{soundMuted ? '🔇' : '🔊'}</span>
            <span className="hidden sm:inline">{soundMuted ? 'Silencio' : 'Sonido'}</span>
          </button>

          <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-center min-w-[55px]">
            <span className="text-slate-400 text-[10px] block uppercase">Total</span>
            <span className="text-base font-bold text-slate-700">{total}</span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-center min-w-[55px]">
            <span className="text-emerald-700 text-[10px] block uppercase">Presentes</span>
            <span className="text-base font-bold text-emerald-700">{escaneados}</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-center min-w-[55px]">
            <span className="text-rose-600 text-[10px] block uppercase">Faltan</span>
            <span className="text-base font-bold text-rose-700">{faltantes}</span>
          </div>
        </div>
      </div>

      {/* Barra de progreso del Checklist */}
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div 
          className="bg-emerald-600 h-2 rounded-full transition-all duration-300" 
          style={{ width: `${total > 0 ? (escaneados / total) * 100 : 0}%` }}
        ></div>
      </div>

      {/* ÁREA CENTRAL DE DISPARO / ESCANEO RÁPIDO */}
      <section className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200 flex flex-col items-center justify-center text-center min-h-[260px]">
        {isSearching ? (
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <div className="w-12 h-12 border-2 border-slate-200 border-t-red-600 rounded-full animate-spin"></div>
            <p className="text-base font-semibold text-slate-600">Verificando serie: <span className="text-red-600 font-bold">{lastScanned}</span>...</p>
          </div>
        ) : searchSuccess ? (
          <div className="flex flex-col items-center gap-2 animate-fade-in">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shadow-xs mb-1 border-2 border-emerald-400">
              <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p className="text-xl font-black text-emerald-700 uppercase">¡SÍ ESTÁ EN EL CHECKLIST!</p>
            <p className="text-slate-900 font-mono text-lg font-bold">{lastScanned}</p>
            {lastScannedMaterial && (
              <span className="text-xs font-semibold bg-emerald-50 px-3 py-1 rounded-lg text-emerald-800 border border-emerald-200">
                Modelo: {lastScannedMaterial}
              </span>
            )}
          </div>
        ) : searchDuplicate ? (
          <div className="flex flex-col items-center gap-2 animate-fade-in">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shadow-xs mb-1 border-2 border-amber-400">
              <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <p className="text-xl font-black text-amber-700 uppercase">¡YA ESTABA REGISTRADA!</p>
            <p className="text-slate-900 font-mono text-base font-bold">{lastScanned}</p>
          </div>
        ) : searchError ? (
          <div className="flex flex-col items-center gap-2 animate-pulse">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border-2 border-rose-400">
              <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </div>
            <p className="text-xl font-black text-rose-700 uppercase">¡NO ESTÁ EN EL CHECKLIST!</p>
            <p className="text-rose-600 font-mono text-base font-bold">{lastScanned}</p>
          </div>
        ) : useCamera ? (
          <CameraScanner 
            expectedSeries={batchDetails.expectedSeries} 
            onScan={processScan} 
            onCancel={() => setUseCamera(false)} 
          />
        ) : (
          <div className="w-full max-w-md flex flex-col items-center gap-4">
            <div className="bg-red-50 p-3.5 rounded-full text-red-600">
              <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-center flex flex-col items-center gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">Escaneo Directo (Sin Ubicación)</p>
                <p className="text-xs text-slate-500 mt-1">
                  Dispara la pistola lectora para marcar cada serie como <strong className="text-emerald-700">Presente</strong> de forma continua
                </p>
              </div>

              <form onSubmit={handleManualSubmit} className="w-full flex gap-2 mt-1">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="ESCANEAR O ESCRIBIR SERIE AQUÍ..."
                  className="flex-1 bg-white border border-slate-300 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 uppercase outline-none"
                />
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition"
                >
                  Verificar
                </button>
              </form>
              
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

      {/* LISTA EN TIEMPO REAL DE SERIES DEL CHECKLIST (SÍ ESTÁ / PENDIENTE) */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            Estado de Series en este Checklist ({escaneados} de {total} verificadas)
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1 text-xs">
          {batchDetails.expectedSeries.map((item, idx) => {
            const isPresent = batchDetails.completed.includes(item.serial);
            return (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border flex items-center justify-between ${
                  isPresent
                    ? 'bg-emerald-50/70 border-emerald-300'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <span className="font-mono font-bold text-slate-800 block truncate">{item.serial}</span>
                  <span className="text-[10px] text-slate-500 block truncate">{item.material}</span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                    isPresent
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isPresent ? '✓ SÍ ESTÁ' : 'PENDIENTE'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}
