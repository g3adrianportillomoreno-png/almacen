import React from 'react';

/**
 * Modal de Opciones Parecidas para el Acomodo de Impresoras.
 * Permite al operador ver y seleccionar a qué equipo de SANTI corresponde
 * una impresora cuando SANTI le agrega ceros al final o existen discrepancias de lectura.
 */
export default function SimilarPrintersModal({
  isOpen,
  onClose,
  scannedCode,
  candidates = [],
  onSelectCandidate
}) {
  if (!isOpen || !candidates || candidates.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Cabecera */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                Sugerencias SANTI
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                {candidates.length} {candidates.length === 1 ? 'opción encontrada' : 'opciones encontradas'}
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-white mt-1">
              ¿A cuál de estos equipos corresponde?
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Serie leída: <strong className="font-mono text-emerald-400 font-bold">{scannedCode}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl p-2 transition shrink-0"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Explicación amigable */}
        <div className="bg-amber-950/40 border-b border-amber-800/40 px-4 py-2.5 text-[11px] text-amber-200/90 flex items-center gap-2">
          <span className="text-base shrink-0">💡</span>
          <span>
            En SANTI suelen agregarse ceros al final. Toca el equipo correcto para asignarle su ubicación:
          </span>
        </div>

        {/* Lista de candidatos desplazable */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-3">
          {candidates.map((cand, idx) => {
            const isTopMatch = idx === 0;

            return (
              <div
                key={cand.serial + idx}
                className={`p-3.5 rounded-2xl border transition ${
                  isTopMatch
                    ? 'bg-slate-800/90 border-emerald-500/60 shadow-md ring-1 ring-emerald-500/30'
                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                }`}
              >
                {/* Etiquetas superiores */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-900/60 text-amber-300 border border-amber-700/60">
                    {cand.reason}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-900 text-emerald-400 border border-slate-700">
                    {cand.rawScore || cand.score}% coincidencia
                  </span>
                </div>

                {/* Serie en SANTI con desglose visual de caracteres */}
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 mb-2.5">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide block mb-1">
                    Serie en SANTI / Sistema:
                  </span>
                  <div className="font-mono text-sm sm:text-base font-bold tracking-wider flex flex-wrap items-center gap-0.5">
                    {cand.expectedChars && cand.expectedChars.length > 0 ? (
                      cand.expectedChars.map((chObj, chIdx) => (
                        <span
                          key={chIdx}
                          className={
                            chObj.diff
                              ? 'bg-amber-500 text-slate-950 px-1 rounded font-black'
                              : 'text-white'
                          }
                          title={chObj.diff ? 'Carácter diferente o cero agregado en SANTI' : 'Coincide'}
                        >
                          {chObj.char}
                        </span>
                      ))
                    ) : (
                      <span className="text-white">{cand.serial}</span>
                    )}
                  </div>
                </div>

                {/* Detalles del modelo y ubicación actual */}
                <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Modelo:</span>
                    <strong className="text-white truncate block">{cand.material || 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Estado Ubicación:</span>
                    <span className={cand.isUnassigned ? 'text-amber-400 font-bold' : 'text-slate-300 font-medium'}>
                      {cand.warehouseLocation}
                    </span>
                  </div>
                </div>

                {/* Botón de selección táctil */}
                <button
                  type="button"
                  onClick={() => onSelectCandidate(cand.item)}
                  className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-98 shadow-sm ${
                    isTopMatch
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Asignar Ubicación a este Equipo</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Pie con botón de cancelar */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-between items-center gap-2">
          <span className="text-[10px] text-slate-500 truncate">
            Si no es ninguna, puedes intentar escanear otra vez
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl border border-slate-700 transition"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
}
