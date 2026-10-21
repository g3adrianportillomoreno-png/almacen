import { useState, useMemo } from 'react';
import { findSimilarSerialMatches } from '../utils/serialMatcher';

export default function SerialSimilarityModal({
  isOpen,
  onClose,
  batchDetails,
  onAcceptMatch,
  onAcceptAll
}) {
  const [processingSerial, setProcessingSerial] = useState(null);
  const [processingAll, setProcessingAll] = useState(false);

  const missingItems = useMemo(() => {
    if (!batchDetails?.expectedSeries) return [];
    const completedSet = new Set(batchDetails.completed || []);
    return batchDetails.expectedSeries.filter((item) => !completedSet.has(item.serial));
  }, [batchDetails?.expectedSeries, batchDetails?.completed]);

  const unexpectedLogs = useMemo(() => {
    return batchDetails?.unexpectedLogs || [];
  }, [batchDetails?.unexpectedLogs]);

  const matches = useMemo(() => {
    return findSimilarSerialMatches(missingItems, unexpectedLogs);
  }, [missingItems, unexpectedLogs]);

  if (!isOpen || !batchDetails) return null;

  const handleSingleAccept = async (match) => {
    try {
      setProcessingSerial(match.expectedSerial);
      await onAcceptMatch(match);
    } finally {
      setProcessingSerial(null);
    }
  };

  const handleAcceptAll = async () => {
    if (!matches.length) return;
    try {
      setProcessingAll(true);
      if (onAcceptAll) {
        await onAcceptAll(matches);
      } else {
        for (const m of matches) {
          await onAcceptMatch(m);
        }
      }
    } finally {
      setProcessingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden text-slate-800">
        {/* Cabecera */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-amber-500 text-slate-950 text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase">
                Comparador Inteligente
              </span>
              <span className="text-xs text-slate-300 font-semibold">{batchDetails.folio}</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold mt-1">
              Coincidencias entre Faltantes y Lecturas con Error
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Detecta números de serie muy parecidos cuando el PDF tenía un dígito mal leído por OCR pero la impresora sí se escaneó físicamente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl p-2 transition shrink-0"
            title="Cerrar ventana"
          >
            ✕
          </button>
        </div>

        {/* Barra de resumen */}
        <div className="bg-slate-50 px-4 sm:px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-amber-100 text-amber-900 font-bold px-2.5 py-1 rounded-lg border border-amber-200">
              ⏳ Faltantes en lista: {missingItems.length}
            </span>
            <span className="bg-rose-100 text-rose-900 font-bold px-2.5 py-1 rounded-lg border border-rose-200">
              ⚠️ Escaneos con error: {unexpectedLogs.length}
            </span>
            <span className="bg-emerald-100 text-emerald-900 font-bold px-2.5 py-1 rounded-lg border border-emerald-300">
              ✨ Coincidencias altas: {matches.length}
            </span>
          </div>

          {matches.length > 1 && (
            <button
              type="button"
              disabled={processingAll}
              onClick={handleAcceptAll}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1.5 text-xs cursor-pointer"
            >
              <span>✓ Aceptar y Corregir Todas ({matches.length})</span>
            </button>
          )}
        </div>

        {/* Contenido desplazable */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {matches.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-6 text-center space-y-2">
              <div className="w-12 h-12 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
                🔍
              </div>
              <h4 className="text-sm font-bold text-slate-800">
                No se encontraron series con alto grado de similitud
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                {unexpectedLogs.length === 0
                  ? 'No hay lecturas registradas con error en este checklist para comparar contra las series faltantes.'
                  : 'Ninguna de las series que dieron error al escanear se parece lo suficiente (mínimo 80% de similitud) a las series que faltan por verificar.'}
              </p>

              {unexpectedLogs.length > 0 && missingItems.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 text-left">
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                    <span className="text-[11px] font-bold text-amber-900 uppercase block mb-1.5">
                      Faltantes en PDF ({missingItems.length})
                    </span>
                    <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-xs text-slate-800">
                      {missingItems.map((it, idx) => (
                        <div key={idx} className="bg-white px-2 py-1 rounded border border-amber-100">
                          {it.serial}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3">
                    <span className="text-[11px] font-bold text-rose-900 uppercase block mb-1.5">
                      Escaneadas con Error ({unexpectedLogs.length})
                    </span>
                    <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-xs text-rose-800">
                      {unexpectedLogs.map((raw, idx) => {
                        const val = typeof raw === 'string' ? raw : (raw?.scannedValue || raw?.scanned_value || '');
                        return (
                          <div key={idx} className="bg-white px-2 py-1 rounded border border-rose-100">
                            {val}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {matches.map((match) => {
                const isBusy = processingSerial === match.expectedSerial || processingAll;
                return (
                  <div
                    key={`${match.expectedSerial}-${match.scannedSerial}`}
                    className="bg-white border-2 border-slate-200 hover:border-emerald-400 rounded-2xl p-4 shadow-2xs transition flex flex-col gap-3"
                  >
                    {/* Encabezado de la tarjeta de coincidencia */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-emerald-100 text-emerald-800 font-black text-[11px] px-2.5 py-0.5 rounded-full border border-emerald-300">
                          {match.similarityPercent}% SIMILITUD
                        </span>
                        <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                          {match.reasonLabel}
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500">
                        Modelo: <strong className="text-slate-800">{match.material}</strong>
                        {match.documentName ? ` • 📄 ${match.documentName}` : ''}
                      </span>
                    </div>

                    {/* Comparación visual carácter por carácter */}
                    <div className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                      {/* Serie en el PDF (Faltante) */}
                      <div className="md:col-span-5 bg-amber-50/80 border border-amber-200 rounded-xl p-2.5">
                        <span className="text-[10px] font-bold text-amber-800 uppercase block mb-1">
                          📄 En Checklist (Faltante / Error OCR):
                        </span>
                        <div className="font-mono text-sm sm:text-base font-bold tracking-wider flex flex-wrap items-center gap-0.5">
                          {match.expectedChars.map((chObj, idx) => (
                            <span
                              key={idx}
                              className={
                                chObj.diff
                                  ? 'bg-amber-300 text-amber-950 px-1 rounded font-black underline decoration-2'
                                  : 'text-slate-700'
                              }
                            >
                              {chObj.char}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Flecha central */}
                      <div className="md:col-span-1 flex items-center justify-center text-slate-400 font-black text-lg">
                        ➔
                      </div>

                      {/* Serie Escaneada Físicamente (Error) */}
                      <div className="md:col-span-5 bg-emerald-50/80 border border-emerald-300 rounded-xl p-2.5">
                        <span className="text-[10px] font-bold text-emerald-800 uppercase block mb-1">
                          🔫 Escaneada Físicamente (Serie Real):
                        </span>
                        <div className="font-mono text-sm sm:text-base font-bold tracking-wider flex flex-wrap items-center gap-0.5">
                          {match.scannedChars.map((chObj, idx) => (
                            <span
                              key={idx}
                              className={
                                chObj.diff
                                  ? 'bg-emerald-300 text-emerald-950 px-1 rounded font-black underline decoration-2'
                                  : 'text-slate-800'
                              }
                            >
                              {chObj.char}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Botón de confirmación */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-[11px] text-slate-500">
                        Al aceptar, se actualizará a <strong className="font-mono text-slate-800">{match.scannedSerial}</strong> y se marcará como <strong className="text-emerald-700">✓ SÍ ESTÁ</strong>.
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleSingleAccept(match)}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-xs shrink-0 cursor-pointer active:scale-95"
                      >
                        {isBusy ? 'Aplicando...' : '✓ Aceptar y Marcar Presente'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-900 text-white font-semibold px-5 py-2 rounded-xl text-xs transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
