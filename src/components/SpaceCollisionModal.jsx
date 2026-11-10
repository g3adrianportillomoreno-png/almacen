import React from 'react';

/**
 * Modal para Resolución de Colisión de Espacios (Opción 2):
 * Permite al operador elegir qué hacer cuando el espacio ingresado ya tiene una máquina asignada:
 * 1. Reemplazar y Desalojar (la anterior pasa a Pendiente de Ubicación).
 * 2. Intercambiar Lugares (ambas máquinas intercambian sus ubicaciones).
 * 3. Compartir Espacio (ambas máquinas se quedan en la misma tarima/espacio).
 */
export default function SpaceCollisionModal({
  isOpen,
  onClose,
  targetLocation = {},
  currentOccupant = null,
  incomingPrinter = null,
  onResolve,
  isSubmitting = false
}) {
  if (!isOpen || !currentOccupant || !incomingPrinter) return null;

  const hasIncomingPrevLocation = Boolean(
    incomingPrinter.warehouseSpace &&
    incomingPrinter.warehouseRow &&
    incomingPrinter.warehouseRow !== 'Sin Asignar' &&
    incomingPrinter.warehouseSpace.trim() !== ''
  );

  const incomingPrevText = hasIncomingPrevLocation
    ? `${incomingPrinter.warehouseName || 'Almacén'} → ${incomingPrinter.warehouseRow} [${incomingPrinter.warehouseSpace}]`
    : 'Sin Ubicación Previa (Pendiente)';

  const targetText = `${targetLocation.warehouse || 'Almacén'} → ${targetLocation.row || 'Fila'} [${targetLocation.space || 'General'}]`;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Cabecera */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-lg font-bold shrink-0">
              ⚠️
            </span>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                Colisión de Espacio
              </span>
              <h3 className="text-sm sm:text-base font-bold text-white">
                El espacio ya tiene un equipo asignado
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl p-1.5 transition shrink-0"
            title="Cancelar"
          >
            ✕
          </button>
        </div>

        {/* Ubicación en conflicto */}
        <div className="bg-amber-950/40 border-b border-amber-800/40 px-4 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 font-semibold flex items-center gap-1.5">
            <span>📍</span> Espacio en conflicto:
          </span>
          <strong className="font-mono text-amber-300 font-black">
            {targetText}
          </strong>
        </div>

        {/* Contenido desplazable */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3.5">
          
          {/* Tarjeta del Equipo Ocupante Actual */}
          <div className="bg-slate-950/90 border border-rose-500/40 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-rose-400 uppercase tracking-wide flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                Equipo Ocupante Actual:
              </span>
              <span className="text-[10px] text-slate-400 font-mono">En esta posición</span>
            </div>
            <div className="text-xs">
              <p className="font-mono text-sm font-black text-white">{currentOccupant.serial}</p>
              <p className="text-slate-300 font-medium truncate mt-0.5">
                {currentOccupant.material || 'Modelo Desconocido'}
                {currentOccupant.internalNumber ? ` • Equipo #${currentOccupant.internalNumber}` : ''}
              </p>
            </div>
          </div>

          {/* Tarjeta del Equipo Nuevo a Colocar */}
          <div className="bg-slate-950/90 border border-emerald-500/40 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Equipo Nuevo a Colocar:
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Entrante</span>
            </div>
            <div className="text-xs">
              <p className="font-mono text-sm font-black text-white">{incomingPrinter.serial}</p>
              <p className="text-slate-300 font-medium truncate mt-0.5">
                {incomingPrinter.material || 'Modelo Desconocido'}
                {incomingPrinter.internalNumber ? ` • Equipo #${incomingPrinter.internalNumber}` : ''}
              </p>
              <p className="text-[10px] text-slate-400 mt-1">
                Ubicación previa: <strong className="text-slate-300">{incomingPrevText}</strong>
              </p>
            </div>
          </div>

          {/* Pregunta */}
          <div className="text-center pt-1">
            <p className="text-xs font-bold text-slate-200">
              ¿Qué acción deseas realizar con este espacio?
            </p>
          </div>

          {/* 3 Botones de Acción (Opción 2) */}
          <div className="space-y-2">
            
            {/* Opción A: Reemplazar y Desalojar */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onResolve('REPLACE')}
              className="w-full text-left p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-amber-500/50 hover:border-amber-400 transition flex items-center justify-between gap-3 active:scale-98 shadow-sm cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold text-base shrink-0">
                  🔄
                </span>
                <div>
                  <h4 className="text-xs font-black text-white">
                    1. Reemplazar y Desalojar
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    La máquina nueva se queda aquí. La anterior pasa a <strong>Pendiente de Ubicación</strong>.
                  </p>
                </div>
              </div>
              <span className="text-amber-400 text-xs font-bold">&rarr;</span>
            </button>

            {/* Opción B: Intercambiar Lugares (Swap) */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onResolve('SWAP')}
              className={`w-full text-left p-3 rounded-2xl border transition flex items-center justify-between gap-3 active:scale-98 shadow-sm cursor-pointer disabled:opacity-50 ${
                hasIncomingPrevLocation
                  ? 'bg-slate-800/80 hover:bg-slate-800 border-blue-500/50 hover:border-blue-400'
                  : 'bg-slate-800/40 border-slate-700 opacity-80'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center font-bold text-base shrink-0">
                  🔁
                </span>
                <div>
                  <h4 className="text-xs font-black text-white">
                    2. Intercambiar Posiciones (Enroque)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {hasIncomingPrevLocation
                      ? `La máquina anterior se moverá a: ${incomingPrevText}.`
                      : 'La máquina anterior tomará la posición previa de esta máquina.'}
                  </p>
                </div>
              </div>
              <span className="text-blue-400 text-xs font-bold">&rarr;</span>
            </button>

            {/* Opción C: Compartir Espacio (Misma Tarima) */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onResolve('SHARE')}
              className="w-full text-left p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-emerald-500/50 hover:border-emerald-400 transition flex items-center justify-between gap-3 active:scale-98 shadow-sm cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold text-base shrink-0">
                  📦
                </span>
                <div>
                  <h4 className="text-xs font-black text-white">
                    3. Compartir Espacio (Misma Tarima)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Ambas máquinas se guardan juntas en este mismo espacio.
                  </p>
                </div>
              </div>
              <span className="text-emerald-400 text-xs font-bold">&rarr;</span>
            </button>

          </div>

        </div>

        {/* Pie con botón para cancelar y escribir otro número */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-between items-center gap-2">
          <span className="text-[10px] text-slate-500 truncate">
            O puedes cambiar el número de espacio
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl border border-slate-700 transition"
          >
            Cancelar / Elegir otro
          </button>
        </div>

      </div>
    </div>
  );
}
