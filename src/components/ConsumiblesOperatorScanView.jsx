// src/components/ConsumiblesOperatorScanView.jsx
import { useState, useEffect, useRef } from 'react';
import { ConsumiblesController } from '../controllers/ConsumiblesController.js';
import { soundEffects } from '../utils/soundEffects.js';
import CameraScanner from './CameraScanner.jsx';

export default function ConsumiblesOperatorScanView() {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanInput, setScanInput] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scanHistory, setScanHistory] = useState([]);
  const [notification, setNotification] = useState(null);

  const scanInputRef = useRef(null);

  useEffect(() => {
    loadCatalogData();
  }, []);

  const loadCatalogData = async () => {
    setLoading(true);
    try {
      const items = await ConsumiblesController.loadCatalog();
      setCatalog(items || []);
    } catch (e) {
      console.warn('Error cargando consumibles en modo operador:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isCameraActive && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [isCameraActive, activeItem]);

  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4000);
  };

  const handleProcessScan = (code) => {
    if (!code || !code.trim()) return;
    const query = code.trim();

    const { match, candidates: matchCandidates } = ConsumiblesController.findMatch(query, catalog);

    if (match) {
      soundEffects.playScanSuccess();
      setActiveItem(match);
      setCandidates(matchCandidates.filter(c => c.id !== match.id));
      showToast('success', `✓ Ubicación: ${match.seccion || 'S/N'} [${match.anaquel || 'S/N'}]`);

      // Agregar a historial reciente
      setScanHistory(prev => [
        {
          item: match,
          timestamp: new Date().toLocaleTimeString('es-MX', { hour12: true })
        },
        ...prev.filter(h => h.item.id !== match.id)
      ].slice(0, 15));

      setScanInput('');
    } else {
      soundEffects.playScanError();
      showToast('error', `❌ No encontrado: "${query}"`);
      setActiveItem(null);
      setCandidates([]);
      setScanInput('');
    }

    if (scanInputRef.current) {
      scanInputRef.current.focus();
    }
  };

  return (
    <div className="flex flex-col gap-4 text-slate-100">
      
      {/* CÁMARA ESCÁNER TÁCTIL */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <CameraScanner
            onScan={(detectedCode) => {
              setIsCameraActive(false);
              handleProcessScan(detectedCode);
            }}
            onClose={() => setIsCameraActive(false)}
          />
        </div>
      )}

      {/* AVISO / TOAST */}
      {notification && (
        <div className={`p-3 rounded-2xl text-xs font-black text-center shadow-lg animate-fade-in ${
          notification.type === 'success'
            ? 'bg-emerald-600 text-white'
            : 'bg-rose-600 text-white'
        }`}>
          {notification.text}
        </div>
      )}

      {/* CABECERA MÓVIL DEL MÓDULO */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏷️</span>
          <div>
            <h2 className="text-sm font-black text-white">Lector de Consumibles</h2>
            <p className="text-[10px] text-slate-400">
              {loading ? 'Cargando catálogo...' : `${catalog.length} consumibles disponibles`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCameraActive(true)}
          className="bg-red-600 hover:bg-red-500 text-white font-black text-xs px-3 py-2 rounded-xl transition flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
        >
          <span>📷</span>
          <span>Cámara</span>
        </button>
      </div>

      {/* BARRA DE ESCANEO GIGANTE */}
      <form 
        onSubmit={(e) => {
          e.preventDefault();
          handleProcessScan(scanInput);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <input
            ref={scanInputRef}
            type="text"
            autoComplete="off"
            placeholder="Escanea el código de barras o escribe la clave..."
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            className="w-full bg-slate-900 border-2 border-red-500/70 focus:border-red-400 text-white placeholder:text-slate-500 rounded-2xl px-4 py-3.5 text-sm font-black font-mono outline-none shadow-inner"
          />
          {scanInput && (
            <button
              type="button"
              onClick={() => setScanInput('')}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="submit"
          className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black px-4 py-3.5 rounded-2xl text-xs flex items-center gap-1 shadow-md cursor-pointer shrink-0"
        >
          <span>🔍</span>
          <span className="hidden sm:inline">Buscar</span>
        </button>
      </form>

      {/* TARJETA GIGANTE: UBICACIÓN Y EXISTENCIAS EN PANTALLA */}
      {activeItem ? (
        <div className="bg-slate-900 border-2 border-emerald-500/80 rounded-3xl p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in">
          
          {/* Identificación del producto */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="bg-white text-slate-900 font-mono font-black text-sm px-3 py-1 rounded-xl shadow-xs">
                {activeItem.clave}
              </span>
              <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-slate-700">
                {activeItem.categoria || 'Consumible'}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-black text-white leading-tight">
              {activeItem.nombre}
            </h1>
          </div>

          {/* UBICACIÓN FÍSICA GIGANTE */}
          <div className="bg-gradient-to-br from-slate-950 to-slate-900 border-2 border-red-500/50 rounded-2xl p-4 flex flex-col gap-2 shadow-inner">
            <div className="text-[11px] font-black uppercase text-red-400 tracking-wider flex items-center gap-1.5">
              <span>📍</span>
              <span>Ubicación en Almacén ({activeItem.almacen || 'Principal'})</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center mt-1">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Sección</span>
                <span className="text-lg sm:text-2xl font-black text-emerald-400 truncate block">
                  {activeItem.seccion || 'S/N'}
                </span>
              </div>

              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Anaquel</span>
                <span className="text-lg sm:text-2xl font-black text-amber-400 truncate block">
                  {activeItem.anaquel || 'S/N'}
                </span>
              </div>

              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Espacio</span>
                <span className="text-lg sm:text-2xl font-black text-cyan-400 truncate block">
                  {activeItem.espacio || 'S/N'}
                </span>
              </div>
            </div>

            {(!activeItem.seccion && !activeItem.anaquel && !activeItem.espacio) && (
              <p className="text-xs text-rose-400 font-bold text-center mt-1">
                ⚠️ Sin ubicación asignada en anaqueles.
              </p>
            )}
          </div>

          {/* CUÁNTOS DEBE HABER (EXISTENCIAS GIGANTES) */}
          <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Existencias en Almacén
            </span>
            <div className="text-4xl sm:text-5xl font-black text-white font-mono my-1 text-emerald-400">
              {activeItem.existencias ?? 0}
            </div>
            <span className={`text-xs font-black px-3 py-1 rounded-full border mt-1 ${
              ConsumiblesController.getStockStatus(activeItem).badgeClass
            }`}>
              {ConsumiblesController.getStockStatus(activeItem).label}
            </span>

            <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-400">
              <span>Mínimo: <strong className="text-white">{activeItem.stock_min || 0}</strong></span>
              <span>•</span>
              <span>Máximo: <strong className="text-white">{activeItem.stock_max || 0}</strong></span>
            </div>
          </div>

          {/* Botón para reiniciar o escanear otro */}
          <button
            type="button"
            onClick={() => {
              setActiveItem(null);
              setCandidates([]);
              if (scanInputRef.current) scanInputRef.current.focus();
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs py-3 rounded-xl border border-slate-700 transition"
          >
            Limpiar y Escanear Siguiente
          </button>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center flex flex-col items-center justify-center gap-2">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center text-3xl mb-1 border border-slate-700">
            🔫
          </div>
          <h3 className="text-sm font-bold text-white">Listo para Escanear Consumible</h3>
          <p className="text-xs text-slate-400 max-w-xs">
            Apunta la pistola lectora al código de barras del consumible o activa la cámara para ver su ubicación física y stock en grande.
          </p>
        </div>
      )}

      {/* CANDIDATOS SIMILARES SI HUBO VARIAS COINCIDENCIAS */}
      {candidates.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase">
            Otras coincidencias encontradas:
          </span>
          <div className="flex flex-col gap-1.5">
            {candidates.map(cand => (
              <button
                key={cand.id}
                onClick={() => {
                  setActiveItem(cand);
                  setCandidates(prev => prev.filter(c => c.id !== cand.id));
                }}
                className="bg-slate-800 hover:bg-slate-700/80 p-2.5 rounded-xl border border-slate-700 text-left transition flex items-center justify-between"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-mono font-bold text-white text-xs block">{cand.clave}</span>
                  <span className="text-[11px] text-slate-300 truncate block">{cand.nombre}</span>
                </div>
                <span className="text-[10px] bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-bold shrink-0">
                  {cand.seccion || 'S/N'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* HISTORIAL RECIENTE DE ESCANEOS EN ESTA SESIÓN */}
      {scanHistory.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase">
              Escaneos Recientes ({scanHistory.length})
            </span>
            <button
              onClick={() => setScanHistory([])}
              className="text-[10px] text-rose-400 hover:underline font-bold"
            >
              Borrar historial
            </button>
          </div>

          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {scanHistory.map((h, idx) => (
              <button
                key={idx}
                onClick={() => setActiveItem(h.item)}
                className="bg-slate-800/60 hover:bg-slate-800 p-2 rounded-xl border border-slate-800 text-left transition flex items-center justify-between text-xs"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-mono font-bold text-emerald-400">{h.item.clave}</span>
                  <span className="text-[11px] text-slate-400 truncate block">{h.item.nombre}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[11px] font-mono font-bold text-amber-400 block">
                    {h.item.seccion || 'S/N'} [{h.item.anaquel || 'S/N'}]
                  </span>
                  <span className="text-[9px] text-slate-500">{h.timestamp}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
