import useOfflineSync from '../hooks/useOfflineSync';

export default function OfflineSyncBanner({ className = '', showAlways = false }) {
  const { isOnline, pendingCount, isSyncing, lastSyncResult, syncNow } = useOfflineSync();

  // Si está online, no hay pendientes y no hubo resultado reciente, no ocupar espacio innecesario a menos que se fuerce
  if (!showAlways && isOnline && pendingCount === 0 && (!lastSyncResult || lastSyncResult.syncedCount === 0)) {
    return null;
  }

  return (
    <div className={`transition-all duration-300 animate-fade-in ${className}`}>
      {/* 1. Alerta de sincronización exitosa reciente */}
      {lastSyncResult && lastSyncResult.syncedCount > 0 && (
        <div className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl shadow-md text-xs font-semibold flex items-center justify-between gap-3 border border-emerald-500">
          <div className="flex items-center gap-2">
            <span className="text-base">✓</span>
            <span>
              ¡<strong>{lastSyncResult.syncedCount}</strong> {lastSyncResult.syncedCount === 1 ? 'escaneo sincronizado' : 'escaneos sincronizados'} exitosamente con la oficina!
            </span>
          </div>
          <span className="text-[10px] bg-emerald-700/80 px-2 py-0.5 rounded-md font-mono">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      )}

      {/* 2. Alerta de Sin Conexión / Modo Offline */}
      {!isOnline && (
        <div className="bg-amber-500 text-slate-950 px-3.5 py-2 rounded-xl shadow-md text-xs font-semibold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border border-amber-600">
          <div className="flex items-center gap-2">
            <span className="text-base">📶</span>
            <div>
              <span className="font-bold">Modo Fuera de Línea (Sin Wi-Fi):</span>{' '}
              <span className="font-medium text-slate-900">
                Puedes seguir escaneando. Los datos se guardan de forma segura en este celular.
              </span>
            </div>
          </div>
          {pendingCount > 0 && (
            <span className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
              {pendingCount} {pendingCount === 1 ? 'pendiente' : 'pendientes'}
            </span>
          )}
        </div>
      )}

      {/* 3. Hay conexión pero quedan escaneos acumulados pendientes de subir */}
      {isOnline && pendingCount > 0 && (!lastSyncResult || lastSyncResult.syncedCount === 0) && (
        <div className="bg-slate-900 text-white px-3.5 py-2 rounded-xl shadow-md text-xs font-semibold flex items-center justify-between gap-3 border border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </span>
            <span className="truncate">
              <strong>{pendingCount}</strong> {pendingCount === 1 ? 'escaneo guardado localmente' : 'escaneos guardados localmente'}{' '}
              <span className="text-slate-400 hidden sm:inline">(esperando subida)</span>
            </span>
          </div>

          <button
            type="button"
            onClick={syncNow}
            disabled={isSyncing}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 ${
              isSyncing
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs active:scale-95'
            }`}
          >
            {isSyncing ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Subiendo...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Sincronizar ahora</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 4. Estado normal (si showAlways está activo) */}
      {showAlways && isOnline && pendingCount === 0 && (!lastSyncResult || lastSyncResult.syncedCount === 0) && (
        <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
          <span>En línea • Sincronizado en tiempo real</span>
        </div>
      )}
    </div>
  );
}
