import { useState, useMemo } from 'react';
import useBarcodeScanner from '../hooks/useBarcodeScanner.js';
import CameraScanner from './CameraScanner.jsx';
import { cleanSerialCore } from '../utils/serialMatcher.js';
import { soundEffects, isSoundMuted, toggleSoundMute } from '../utils/soundEffects.js';
import { MercadoLibreController } from '../controllers/MercadoLibreController.js';

export default function MercadoLibreScanView({
  batchDetails,
  onRecordScan,
  onRecordUnexpected,
  onFinishSession,
  onForceFinish
}) {
  const [soundMuted, setSoundMuted] = useState(() => isSoundMuted());
  const [useCamera, setUseCamera] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState('');

  // Estados de retroalimentación de escaneo
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'duplicate' | 'error', message: string, guide: string, tracking: string, code: string }
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'pending' | 'scanned' | 'unexpected'
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  // Totales
  const items = batchDetails?.items || [];
  const total = items.length;
  const escaneados = items.filter(it => it.isScanned).length;
  const faltantes = Math.max(0, total - escaneados);
  const isFinished = batchDetails?.status === 'completed' || (total > 0 && escaneados >= total);
  const percent = total > 0 ? Math.round((escaneados / total) * 100) : 0;
  const unexpectedLogs = batchDetails?.unexpectedLogs || [];

  // Función inteligente para buscar un paquete por Guía o por Rastreo
  const findMatchingItem = (rawScanned) => {
    if (!rawScanned || !items.length) return null;
    const cleanScanned = cleanSerialCore(rawScanned);
    const upperScanned = String(rawScanned).trim().toUpperCase();

    // 1. Coincidencia exacta en Guía o Rastreo
    for (const item of items) {
      const g = String(item.guideNumber || '').trim().toUpperCase();
      const t = String(item.trackingNumber || '').trim().toUpperCase();
      if (g === upperScanned || t === upperScanned) {
        return { item, matchType: g === upperScanned ? 'guia' : 'rastreo' };
      }
    }

    // 2. Coincidencia normalizada sin ceros/espacios/guiones
    for (const item of items) {
      const cleanG = cleanSerialCore(item.guideNumber);
      const cleanT = cleanSerialCore(item.trackingNumber);
      if (cleanG === cleanScanned || cleanT === cleanScanned) {
        return { item, matchType: cleanG === cleanScanned ? 'guia' : 'rastreo' };
      }
    }

    // 3. Coincidencia parcial si el escáner envía o quita prefijos comunes
    for (const item of items) {
      const cleanG = cleanSerialCore(item.guideNumber);
      const cleanT = cleanSerialCore(item.trackingNumber);
      if (
        (cleanG && cleanScanned.includes(cleanG)) ||
        (cleanT && cleanScanned.includes(cleanT)) ||
        (cleanG && cleanG.includes(cleanScanned) && cleanScanned.length >= 6) ||
        (cleanT && cleanT.includes(cleanScanned) && cleanScanned.length >= 6)
      ) {
        return { item, matchType: 'coincidencia_inteligente' };
      }
    }

    return null;
  };

  // Procesar código leído (pistola, cámara o manual)
  const processScan = (scannedCode, method = 'gun') => {
    if (!scannedCode || scannedCode.trim() === '') return;
    const code = scannedCode.trim().toUpperCase();

    const matchResult = findMatchingItem(code);

    if (matchResult) {
      const { item } = matchResult;

      // Caso A: Ya había sido escaneado previamente (DUPLICADO)
      if (item.isScanned) {
        soundEffects.playScanDuplicate();
        setFeedback({
          type: 'duplicate',
          code,
          guide: item.guideNumber,
          tracking: item.trackingNumber,
          message: '¡PAQUETE YA ESCANEADO! Este paquete ya estaba registrado.'
        });
        return;
      }

      // Caso B: Escaneo Exitoso
      soundEffects.playScanSuccess();
      onRecordScan(batchDetails.id, item.id, method);

      // Si este escaneo completa el 100% del lote
      if (escaneados + 1 >= total) {
        setTimeout(() => {
          soundEffects.playChecklistCompleted();
        }, 200);
      }

      setFeedback({
        type: 'success',
        code,
        guide: item.guideNumber,
        tracking: item.trackingNumber,
        message: '¡PAQUETE VERIFICADO CORRECTAMENTE!'
      });
    } else {
      // Caso C: Código no encontrado en este lote (ERROR / INCIDENCIA)
      soundEffects.playScanError();
      onRecordUnexpected(batchDetails.id, code);

      setFeedback({
        type: 'error',
        code,
        message: '¡CÓDIGO NO ENCONTRADO EN ESTE LOTE!'
      });
    }
  };

  // Escáner de pistola láser
  useBarcodeScanner((code) => {
    processScan(code, 'gun');
  });

  // Envío manual con formulario
  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualCodeInput.trim()) return;
    processScan(manualCodeInput.trim(), 'manual');
    setManualCodeInput('');
  };

  // Filtrado de paquetes en la tabla inferior
  const displayedItems = useMemo(() => {
    let result = items;
    if (filterTab === 'pending') {
      result = items.filter(it => !it.isScanned);
    } else if (filterTab === 'scanned') {
      result = items.filter(it => it.isScanned);
    }

    if (itemSearchQuery.trim()) {
      const q = itemSearchQuery.trim().toLowerCase();
      result = result.filter(
        it => (it.guideNumber || '').toLowerCase().includes(q) || (it.trackingNumber || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, filterTab, itemSearchQuery]);

  return (
    <div className="flex flex-col flex-1 gap-5 w-full pb-16 animate-fade-in max-w-6xl mx-auto">
      
      {/* CABECERA SUPERIOR: DETALLES DEL LOTE Y CONTROLES */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-xs border border-amber-200/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-amber-50/40 via-white to-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-amber-400 text-amber-950 flex items-center justify-center font-black text-sm shrink-0 border border-amber-300 shadow-xs">
            {batchDetails?.folio || 'ML'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-800 truncate">
                {batchDetails?.cleanName || batchDetails?.name}
              </h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                isFinished 
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                  : 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
              }`}>
                {isFinished ? 'Completado' : 'Escaneando'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Registrado: {batchDetails?.date || 'Hoy'} • Lectura de Guías y Rastreo de Mercado Libre
            </p>
          </div>
        </div>

        {/* Botones de Cabecera */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Botón Silenciar / Activar Sonido */}
          <button
            type="button"
            onClick={() => setSoundMuted(toggleSoundMute())}
            className={`p-2 px-3 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border ${
              soundMuted
                ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                : 'bg-emerald-600 text-white border-emerald-500 shadow-xs hover:bg-emerald-500'
            }`}
            title={soundMuted ? 'Sonidos silenciados (clic para activar)' : 'Sonidos activados (clic para silenciar)'}
          >
            <span>{soundMuted ? '🔇' : '🔊'}</span>
            <span>{soundMuted ? 'Mudo' : 'Sonidos'}</span>
          </button>

          {/* Botón Descargar Excel */}
          <button
            type="button"
            onClick={() => MercadoLibreController.exportBatchReportToExcel(batchDetails)}
            className="p-2 px-3 bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition flex items-center gap-1.5"
            title="Descargar reporte con 4 hojas en Excel"
          >
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">Excel</span>
          </button>

          {/* Botón Volver / Pausar */}
          <button
            type="button"
            onClick={onFinishSession}
            className="p-2 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition"
          >
            &larr; Volver
          </button>
        </div>
      </div>

      {/* TARJETA DE ESTADÍSTICAS Y PROGRESO */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-xs border border-slate-200">
        <div className="grid grid-cols-3 gap-3 text-center mb-4">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Esperados</span>
            <span className="text-2xl font-black text-slate-800 mt-0.5 block">{total}</span>
          </div>
          <div className="bg-emerald-50/40 p-3 rounded-xl border border-emerald-200">
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Verificados</span>
            <span className="text-2xl font-black text-emerald-600 mt-0.5 block">{escaneados}</span>
          </div>
          <div className="bg-amber-50/40 p-3 rounded-xl border border-amber-200">
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">Faltantes</span>
            <span className="text-2xl font-black text-amber-600 mt-0.5 block">{faltantes}</span>
          </div>
        </div>

        {/* Barra de Progreso Grande */}
        <div className="flex items-center justify-between text-xs font-bold text-slate-600 mb-1.5">
          <span>Avance de lectura</span>
          <span className={isFinished ? 'text-emerald-600' : 'text-amber-700'}>{percent}%</span>
        </div>
        <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200">
          <div
            className={`h-full transition-all duration-300 ${
              isFinished ? 'bg-emerald-500' : 'bg-amber-400'
            }`}
            style={{ width: `${percent}%` }}
          ></div>
        </div>
      </div>

      {/* ÁREA DE ESCANEO ACTIVO: PISTOLA + CÁMARA + MANUAL */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
              Zona de Escaneo en Vivo
            </h3>
            <p className="text-xs text-slate-500">
              Usa tu <strong>pistola lectora</strong> directo a la etiqueta, abre la <strong>cámara</strong> o escribe el código manualmente.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setUseCamera(prev => !prev)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 border ${
              useCamera
                ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
                : 'bg-slate-800 text-white border-slate-900 hover:bg-slate-900 shadow-xs'
            }`}
          >
            <span>📷</span>
            <span>{useCamera ? 'Cerrar Cámara' : 'Escanear con Cámara'}</span>
          </button>
        </div>

        {/* CÁMARA INTEGRADA (SI ESTÁ ACTIVA) */}
        {useCamera && (
          <div className="p-4 bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-inner">
            <CameraScanner
              onScan={(scannedVal) => {
                processScan(scannedVal, 'camera');
              }}
              onCancel={() => setUseCamera(false)}
            />
          </div>
        )}

        {/* INPUT MANUAL PARA PISTOLA O ESCRITURA */}
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            type="text"
            value={manualCodeInput}
            onChange={(e) => setManualCodeInput(e.target.value)}
            placeholder="Escanea aquí con la pistola o escribe el Número de Guía o Rastreo..."
            className="flex-1 px-4 py-3 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-mono text-sm bg-slate-50 focus:bg-white transition"
            autoFocus
          />
          <button
            type="submit"
            className="px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs transition shadow-xs border border-amber-400 cursor-pointer"
          >
            Escanear
          </button>
        </form>

        {/* BANNERS DE RETROALIMENTACIÓN DE ESCANEO */}
        {feedback && (
          <div
            className={`p-4 rounded-xl border animate-fade-in-up flex items-start gap-3.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : feedback.type === 'duplicate'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-red-50 border-red-300 text-red-900'
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 font-bold ${
              feedback.type === 'success'
                ? 'bg-emerald-200 text-emerald-800'
                : feedback.type === 'duplicate'
                ? 'bg-amber-200 text-amber-900'
                : 'bg-red-200 text-red-800'
            }`}>
              {feedback.type === 'success' ? '✓' : feedback.type === 'duplicate' ? '⚠️' : '✕'}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-black tracking-tight">{feedback.message}</h4>
              <div className="flex flex-wrap items-center gap-3 text-xs mt-1 font-mono">
                {feedback.guide && (
                  <div><span className="font-semibold text-slate-500 font-sans">Guía:</span> <strong>{feedback.guide}</strong></div>
                )}
                {feedback.tracking && (
                  <div><span className="font-semibold text-slate-500 font-sans">Rastreo:</span> <strong>{feedback.tracking}</strong></div>
                )}
                {feedback.type === 'error' && (
                  <div><span className="font-semibold text-red-600 font-sans">Leído:</span> <strong>{feedback.code}</strong></div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* LISTADO DE PAQUETES CON PESTAÑAS (TODOS, FALTANTES, ESCANEADOS, INCIDENCIAS) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        {/* Pestañas y Buscador */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50/50">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                filterTab === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Todos ({total})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                filterTab === 'pending'
                  ? 'bg-amber-500 text-white shadow-2xs'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              Faltantes ({faltantes})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('scanned')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                filterTab === 'scanned'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
              }`}
            >
              Escaneados ({escaneados})
            </button>
            {unexpectedLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setFilterTab('unexpected')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === 'unexpected'
                    ? 'bg-red-600 text-white shadow-2xs'
                    : 'bg-white text-red-600 hover:bg-red-50 border border-red-200'
                }`}
              >
                Incidencias ({unexpectedLogs.length})
              </button>
            )}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              placeholder="Filtrar por Guía o Rastreo..."
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-amber-400 bg-white"
            />
          </div>
        </div>

        {/* TABLA DE ELEMENTOS */}
        {filterTab === 'unexpected' ? (
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {unexpectedLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">Sin lecturas inesperadas</div>
            ) : (
              unexpectedLogs.map((un, idx) => (
                <div key={idx} className="p-3.5 flex items-center justify-between text-xs bg-red-50/30">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-md">
                      #{idx + 1}
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {typeof un === 'string' ? un : (un?.scannedValue || '')}
                    </span>
                  </div>
                  <span className="text-[11px] text-red-700 font-semibold">
                    Código fuera de este lote
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="py-2.5 px-4 w-12">#</th>
                  <th className="py-2.5 px-4">Número de Guía</th>
                  <th className="py-2.5 px-4">Número de Rastreo</th>
                  <th className="py-2.5 px-4">Estado</th>
                  <th className="py-2.5 px-4 text-right">Hora Escaneo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedItems.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-400 font-medium">
                      No hay paquetes que coincidan con el filtro
                    </td>
                  </tr>
                ) : (
                  displayedItems.map((it, idx) => (
                    <tr
                      key={it.id || idx}
                      className={`hover:bg-slate-50 transition-colors ${
                        it.isScanned ? 'bg-emerald-50/20' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-800">
                        {it.guideNumber}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">
                        {it.trackingNumber}
                      </td>
                      <td className="py-2.5 px-4">
                        {it.isScanned ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full border border-emerald-300">
                            ✓ Escaneado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100/80 px-2.5 py-0.5 rounded-full border border-amber-300">
                            ⏳ Faltante
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-400 font-mono text-[11px]">
                        {it.scannedAt ? new Date(it.scannedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
