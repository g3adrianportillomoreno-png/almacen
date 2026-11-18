// src/components/ConsumiblesOperatorScanView.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
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

  // Estados para vinculación de código nuevo (ej. EAN 6920952323115)
  const [unlinkedCode, setUnlinkedCode] = useState(null);
  const [linkingSearch, setLinkingSearch] = useState('');
  const [showManualLinkInput, setShowManualLinkInput] = useState(false);
  const [additionalBarcodeInput, setAdditionalBarcodeInput] = useState('');

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
    if (!isCameraActive && !unlinkedCode && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [isCameraActive, activeItem, unlinkedCode]);

  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Coincidencias predictivas en tiempo real mientras el operador escribe en el input principal
  const liveSuggestions = useMemo(() => {
    const q = scanInput.trim();
    if (!q || q.length < 2) return [];
    return ConsumiblesController.searchPredictive(q, catalog, 6);
  }, [scanInput, catalog]);

  // Coincidencias predictivas para la pantalla de vinculación de código nuevo
  const linkingSuggestions = useMemo(() => {
    const q = linkingSearch.trim();
    if (!q) return catalog.slice(0, 6);
    return ConsumiblesController.searchPredictive(q, catalog, 8);
  }, [linkingSearch, catalog]);

  const handleSelectProduct = (item) => {
    soundEffects.playScanSuccess();
    setActiveItem(item);
    setCandidates([]);
    setUnlinkedCode(null);
    setScanInput('');
    showToast('success', `✓ Ubicación: ${item.seccion || 'S/N'} [${item.anaquel || 'S/N'}]`);

    setScanHistory(prev => [
      {
        item,
        timestamp: new Date().toLocaleTimeString('es-MX', { hour12: true })
      },
      ...prev.filter(h => h.item.id !== item.id)
    ].slice(0, 15));
  };

  const handleProcessScan = (code) => {
    if (!code || !code.trim()) return;
    const query = code.trim();

    const { match, candidates: matchCandidates, matchedByBarcode } = ConsumiblesController.findMatch(query, catalog);

    if (match) {
      handleSelectProduct(match);
      if (matchCandidates && matchCandidates.length > 1) {
        setCandidates(matchCandidates.filter(c => c.id !== match.id));
      }
      if (matchedByBarcode) {
        showToast('success', `✓ Código vinculado reconocido: ${query} ➔ ${match.clave}`);
      }
    } else {
      soundEffects.playScanError();
      // Si no se encuentra, abrir de inmediato el asistente de vinculación inteligente
      setUnlinkedCode(query);
      setLinkingSearch('');
      setActiveItem(null);
      setCandidates([]);
      setScanInput('');
      showToast('warning', `Código nuevo "${query}". Selecciona a qué producto pertenece para vincularlo.`);
    }

    if (scanInputRef.current) {
      scanInputRef.current.focus();
    }
  };

  // Confirmar la vinculación del código al consumible
  const handleConfirmLink = async (targetItem, codeToLink) => {
    if (!targetItem || !codeToLink) return;
    try {
      const updated = await ConsumiblesController.linkBarcode(codeToLink, targetItem.id);
      if (updated) {
        setCatalog(prev => prev.map(c => c.id === targetItem.id ? updated : c));
        setActiveItem(updated);
        setUnlinkedCode(null);
        setLinkingSearch('');
        setShowManualLinkInput(false);
        setAdditionalBarcodeInput('');
        soundEffects.playScanSuccess();
        showToast('success', `✓ ¡Código ${codeToLink} vinculado permanentemente a ${updated.clave}!`);

        setScanHistory(prev => [
          {
            item: updated,
            timestamp: new Date().toLocaleTimeString('es-MX', { hour12: true })
          },
          ...prev.filter(h => h.item.id !== updated.id)
        ].slice(0, 15));
      }
    } catch (e) {
      console.error('Error vinculando código:', e);
      showToast('error', 'Error al vincular el código de barras.');
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
            : notification.type === 'warning'
              ? 'bg-amber-500 text-slate-950 font-black'
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

      {/* ASISTENTE DE AUTO-VINCULACIÓN (CUANDO SE ESCANEA UN CÓDIGO NUEVO COMO 6920952323115) */}
      {unlinkedCode && (
        <div className="bg-gradient-to-br from-amber-950 via-slate-900 to-slate-950 border-2 border-amber-500 rounded-3xl p-4 sm:p-5 shadow-2xl flex flex-col gap-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-400 uppercase flex items-center gap-1.5">
              <span>🔗</span>
              <span>Código Nuevo de Fábrica Detectado</span>
            </span>
            <button
              onClick={() => setUnlinkedCode(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-slate-800 rounded-lg"
            >
              ✕ Cerrar
            </button>
          </div>

          <div className="bg-slate-950 border border-amber-500/50 p-2.5 rounded-xl font-mono text-center font-black text-amber-300 text-sm tracking-wider">
            {unlinkedCode}
          </div>

          <p className="text-xs text-slate-300">
            Escribe 2 letras o números del modelo (ej. <strong>03847</strong> o <strong>MX61</strong>) para vincularlo en 1 toque y no tener que registrarlo después:
          </p>

          <input
            type="text"
            placeholder="Buscar modelo (ej. 03847, Sharp 61, Brother 227)..."
            value={linkingSearch}
            onChange={(e) => setLinkingSearch(e.target.value)}
            className="w-full bg-slate-900 border-2 border-amber-500/70 text-white rounded-xl px-3.5 py-2.5 text-xs font-bold outline-none"
            autoFocus
          />

          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {linkingSuggestions.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No hay consumibles con ese texto.</p>
            ) : (
              linkingSuggestions.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleConfirmLink(item, unlinkedCode)}
                  className="bg-slate-900 hover:bg-slate-800 p-3 rounded-2xl border border-slate-700 text-left transition flex items-center justify-between active:scale-98 cursor-pointer"
                >
                  <div className="min-w-0 pr-2">
                    <span className="font-mono font-black text-white text-xs block">{item.clave}</span>
                    <span className="text-[11px] text-slate-300 truncate block">{item.nombre}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-bold block">
                      {item.seccion || 'S/N'} [{item.anaquel || 'S/N'}]
                    </span>
                    <span className="text-[10px] text-amber-400 font-bold block mt-1">
                      Vincular ➔
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* BARRA DE ESCANEO GIGANTE CON SUGERENCIAS PREDICTIVAS */}
      <div className="relative">
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
              placeholder="Escanea con la pistola o escribe (ej. 03847, MX61)..."
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

        {/* LISTA PREDICTIVA EN TIEMPO REAL MIENTRAS EL OPERADOR ESCRIBE */}
        {liveSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl p-2 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            <div className="text-[10px] font-bold text-slate-400 px-2 py-0.5 uppercase">
              Sugerencias rápidas:
            </div>
            {liveSuggestions.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectProduct(item)}
                className="bg-slate-800 hover:bg-slate-700/90 p-2.5 rounded-xl border border-slate-700 text-left transition flex items-center justify-between text-xs"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-mono font-black text-emerald-400 block">{item.clave}</span>
                  <span className="text-[11px] text-slate-300 truncate block">{item.nombre}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] bg-slate-900 text-amber-400 border border-slate-700 px-2 py-0.5 rounded font-mono font-bold block">
                    {item.seccion || 'S/N'} [{item.anaquel || 'S/N'}]
                  </span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">
                    {item.existencias} pzas
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

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

            {/* Códigos de barra vinculados */}
            {Array.isArray(activeItem.barcodes) && activeItem.barcodes.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Códigos vinculados:</span>
                {activeItem.barcodes.map(b => (
                  <span key={b} className="bg-slate-800 text-amber-400 font-mono text-[10px] font-bold px-2 py-0.5 rounded border border-slate-700">
                    {b}
                  </span>
                ))}
              </div>
            )}
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

          {/* Botón para vincular otro código de barras a este mismo producto */}
          {!showManualLinkInput ? (
            <button
              type="button"
              onClick={() => setShowManualLinkInput(true)}
              className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>🔗</span>
              <span>+ Vincular otro código de barras a este consumible</span>
            </button>
          ) : (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-300">Escanea o escribe el nuevo código a vincular:</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Escanea aquí con la pistola..."
                  value={additionalBarcodeInput}
                  onChange={(e) => setAdditionalBarcodeInput(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs font-mono font-bold outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleConfirmLink(activeItem, additionalBarcodeInput)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1 rounded-lg cursor-pointer"
                >
                  Vincular
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualLinkInput(false)}
                  className="bg-slate-800 text-slate-400 text-xs px-2 py-1 rounded-lg"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Botón para reiniciar o escanear otro */}
          <button
            type="button"
            onClick={() => {
              setActiveItem(null);
              setCandidates([]);
              setUnlinkedCode(null);
              if (scanInputRef.current) scanInputRef.current.focus();
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs py-3 rounded-xl border border-slate-700 transition"
          >
            Limpiar y Escanear Siguiente
          </button>
        </div>
      ) : (
        !unlinkedCode && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center flex flex-col items-center justify-center gap-2">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center text-3xl mb-1 border border-slate-700">
              🔫
            </div>
            <h3 className="text-sm font-bold text-white">Listo para Escanear Consumible</h3>
            <p className="text-xs text-slate-400 max-w-xs">
              Apunta la pistola lectora a la caja o escribe 2 números del modelo (ej. <strong>03847</strong> o <strong>MX61</strong>).
            </p>
          </div>
        )
      )}

      {/* CANDIDATOS SIMILARES SI HUBO VARIAS COINCIDENCIAS */}
      {candidates.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase">
            Otras marcas / modelos encontrados:
          </span>
          <div className="flex flex-col gap-1.5">
            {candidates.map(cand => (
              <button
                key={cand.id}
                onClick={() => handleSelectProduct(cand)}
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
