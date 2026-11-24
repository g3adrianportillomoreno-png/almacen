// src/components/ConsumiblesChecklistScanView.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { ConsumiblesChecklistRepository } from '../services/ConsumiblesChecklistRepository.js';
import { soundEffects } from '../utils/soundEffects.js';

export default function ConsumiblesChecklistScanView({
  batchId,
  initialBatch = null,
  onBack,
  onBatchUpdated
}) {
  const [batch, setBatch] = useState(initialBatch);
  const [loading, setLoading] = useState(!initialBatch);
  const [scanInput, setScanInput] = useState('');
  const [multiplier, setMultiplier] = useState(1);
  const [keepMultiplier, setKeepMultiplier] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'COMPLETED' | 'SURPLUS'
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState(null);
  const [isCommittingStock, setIsCommittingStock] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingQtyInput, setEditingQtyInput] = useState('');

  const scanInputRef = useRef(null);

  useEffect(() => {
    loadBatchData();
  }, [batchId]);

  const loadBatchData = async () => {
    if (!batchId) return;
    try {
      const data = ConsumiblesChecklistRepository.getBatchById(batchId);
      if (data) {
        setBatch(data);
      } else {
        const cloudBatches = await ConsumiblesChecklistRepository.fetchAllConsumablesBatches();
        const found = cloudBatches.find(b => String(b.id) === String(batchId));
        if (found) setBatch(found);
      }
    } catch (e) {
      console.warn('Error cargando lote de consumibles:', e);
    } finally {
      setLoading(false);
    }
  };

  // Mantener autoenfoque constante en el input para la pistola lectora
  useEffect(() => {
    const focusScanner = () => {
      if (!editingItemId && scanInputRef.current) {
        scanInputRef.current.focus();
      }
    };
    focusScanner();
    const timer = setTimeout(focusScanner, 200);
    return () => clearTimeout(timer);
  }, [batch, activeItem, editingItemId]);

  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Procesar escaneo continuo con la pistola
  const handleProcessScan = async (codeToScan = scanInput) => {
    const code = String(codeToScan || '').trim();
    if (!code || !batch) return;

    const qtyToCount = Math.max(1, parseInt(multiplier, 10) || 1);
    const result = await ConsumiblesChecklistRepository.recordScan(batch.id, code, qtyToCount, 'Operador');

    if (!result.success) {
      soundEffects.playScanError();
      showToast('error', result.message || `Código "${code}" no encontrado en este lote.`);
      setScanInput('');
      return;
    }

    // Efectos de sonido y retroalimentación inmediata
    if (result.isSurplus) {
      soundEffects.playScanDuplicate();
      showToast('warning', `⚠️ ¡Excedente! Se han contado ${result.item.scannedQty} de ${result.item.expectedQty} esperadas (+${result.item.scannedQty - result.item.expectedQty}).`);
    } else if (result.isItemCompleted) {
      soundEffects.playScanSuccess();
      showToast('success', `🎉 ¡Partida completa! ${result.item.code} (${result.item.scannedQty}/${result.item.expectedQty} pzas).`);
    } else {
      soundEffects.playScanSuccess();
      showToast('success', `✓ +${qtyToCount} pza(s) contadas de ${result.item.code}. Faltan ${result.item.pendingQty}.`);
    }

    setActiveItem(result.item);
    setBatch(result.batch);
    if (onBatchUpdated) onBatchUpdated(result.batch);

    // Si no está bloqueado el multiplicador, regresar a 1 por seguridad
    if (!keepMultiplier) {
      setMultiplier(1);
    }
    setScanInput('');
  };

  // Ajuste manual de cantidad de una partida
  const handleSaveManualAdjustment = async (item) => {
    const newQty = parseInt(editingQtyInput, 10);
    if (isNaN(newQty) || newQty < 0) {
      alert("Por favor ingresa una cantidad numérica válida mayor o igual a 0.");
      return;
    }

    const updatedBatch = await ConsumiblesChecklistRepository.adjustItemQuantity(batch.id, item.id, newQty, 'Operador');
    if (updatedBatch) {
      setBatch(updatedBatch);
      if (onBatchUpdated) onBatchUpdated(updatedBatch);
      const updatedItem = updatedBatch.items.find(it => it.id === item.id);
      if (updatedItem) setActiveItem(updatedItem);
      showToast('success', `✓ Cantidad ajustada a ${newQty} piezas para ${item.code}.`);
    }
    setEditingItemId(null);
    setEditingQtyInput('');
  };

  // Marcar una partida como completada al 100%
  const handleMarkItemComplete = async (item) => {
    if (item.scannedQty >= item.expectedQty) return;
    const confirm = window.confirm(`¿Confirmas que recibiste todas las ${item.expectedQty} piezas de ${item.code} (${item.description})?`);
    if (!confirm) return;

    const updatedBatch = await ConsumiblesChecklistRepository.adjustItemQuantity(batch.id, item.id, item.expectedQty, 'Operador');
    if (updatedBatch) {
      soundEffects.playScanSuccess();
      setBatch(updatedBatch);
      if (onBatchUpdated) onBatchUpdated(updatedBatch);
      const updatedItem = updatedBatch.items.find(it => it.id === item.id);
      if (updatedItem) setActiveItem(updatedItem);
      showToast('success', `✓ Partida ${item.code} completada al 100% (${item.expectedQty} pzas).`);
    }
  };

  // Ingresar existencias contadas al Catálogo Maestro de Consumibles
  const handleCommitStock = async () => {
    if (!batch) return;
    const totalCounted = batch.totalScannedUnits || 0;
    if (totalCounted <= 0) {
      alert("Aún no has contado ninguna pieza en este lote.");
      return;
    }

    const confirm = window.confirm(
      `¿Deseas ingresar las ${totalCounted} piezas contadas directamente al stock del inventario de almacén?\n\n` +
      `Esta acción sumará las cantidades a las existencias maestras y dejará registro oficial.`
    );
    if (!confirm) return;

    setIsCommittingStock(true);
    try {
      const res = await ConsumiblesChecklistRepository.commitStockToInventory(batch.id);
      await loadBatchData();
      soundEffects.playScanSuccess();
      alert(`✓ ¡Éxito! Se actualizaron ${res.updatedCount} productos ingresando ${res.totalPiecesAdded} piezas al inventario.`);
    } catch (err) {
      alert("Aviso: " + err.message);
    } finally {
      setIsCommittingStock(false);
    }
  };

  // Filtrado reactivo de partidas
  const filteredItems = useMemo(() => {
    if (!batch?.items) return [];
    const q = searchQuery.trim().toLowerCase();

    return batch.items.filter(it => {
      if (statusFilter === 'PENDING' && (it.pendingQty || 0) <= 0) return false;
      if (statusFilter === 'COMPLETED' && it.scannedQty < it.expectedQty) return false;
      if (statusFilter === 'SURPLUS' && it.scannedQty <= it.expectedQty) return false;

      if (!q) return true;
      const code = String(it.code || '').toLowerCase();
      const barcode = String(it.barcode || '').toLowerCase();
      const desc = String(it.description || '').toLowerCase();
      const loc = String(it.location || '').toLowerCase();
      const oem = String(it.oemRef || '').toLowerCase();
      const models = String(it.forUseIn || '').toLowerCase();

      return (
        code.includes(q) ||
        barcode.includes(q) ||
        desc.includes(q) ||
        loc.includes(q) ||
        oem.includes(q) ||
        models.includes(q)
      );
    });
  }, [batch?.items, statusFilter, searchQuery]);

  // Coincidencias predictivas para escaneo manual por si el barcode no es legible
  const liveSuggestions = useMemo(() => {
    const q = scanInput.trim().toUpperCase();
    if (!q || q.length < 1 || !batch?.items) return [];
    return batch.items.filter(it => {
      const code = String(it.code || '').toUpperCase();
      const barcode = String(it.barcode || '');
      const desc = String(it.description || '').toUpperCase();
      return code.includes(q) || barcode.includes(q) || desc.includes(q);
    }).slice(0, 6);
  }, [scanInput, batch?.items]);

  if (loading || !batch) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 bg-slate-50">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-bold text-slate-700">Cargando checklist de consumibles...</p>
      </div>
    );
  }

  const progressPct = batch.totalExpectedUnits > 0
    ? Math.min(100, Math.round((batch.totalScannedUnits / batch.totalExpectedUnits) * 100))
    : 0;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 flex flex-col gap-4 animate-in fade-in duration-200">
      
      {/* ======================================================== */}
      {/* 1. ENCABEZADO Y RESUMEN GENERAL DEL LOTE */}
      {/* ======================================================== */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 text-white rounded-3xl p-4 sm:p-6 shadow-xl border border-indigo-800/40 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                🧪 Checklist de Consumibles
              </span>
              <span className="bg-white/10 text-white font-mono font-bold text-xs px-2.5 py-0.5 rounded-lg border border-white/15">
                {batch.folio}
              </span>
              {batch.invoiceNumber && (
                <span className="bg-amber-400/20 text-amber-300 font-mono text-xs px-2 py-0.5 rounded-lg border border-amber-300/30">
                  Factura: {batch.invoiceNumber}
                </span>
              )}
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-white mt-1 tracking-tight">
              {batch.cleanName || batch.name}
            </h1>
            {batch.supplierName && (
              <p className="text-xs text-indigo-200/90 mt-0.5">
                Proveedor: <strong>{batch.supplierName}</strong>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => ConsumiblesChecklistRepository.exportChecklistToExcel(batch)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="Descargar este reporte de recepción completo en Excel"
            >
              <span>📥</span>
              <span>Exportar Excel</span>
            </button>

            <button
              type="button"
              onClick={handleCommitStock}
              disabled={isCommittingStock || Boolean(batch.stockCommittedAt)}
              className={`text-xs font-bold px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer ${
                batch.stockCommittedAt
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 cursor-default'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
              title="Ingresar las piezas contadas al stock maestro de almacén"
            >
              <span>📦</span>
              <span>
                {batch.stockCommittedAt ? 'Stock Ingresado ✓' : 'Ingresar a Stock'}
              </span>
            </button>

            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs px-3 py-2 rounded-xl transition border border-white/20 cursor-pointer"
              >
                &larr; Volver
              </button>
            )}
          </div>
        </div>

        {/* MÉTRICAS GLOBALES */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-white/10">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
            <span className="text-[10px] text-indigo-200/80 uppercase font-black tracking-wider block">
              Piezas Esperadas
            </span>
            <span className="text-xl sm:text-2xl font-black text-white font-mono">
              {batch.totalExpectedUnits?.toLocaleString('es-MX') || 0}
            </span>
            <span className="text-[10px] text-indigo-300/70 block mt-0.5">
              en {batch.totalItems || batch.items.length} partidas (SKUs)
            </span>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-400/20 rounded-2xl p-3">
            <span className="text-[10px] text-emerald-200 uppercase font-black tracking-wider block">
              Piezas Recibidas
            </span>
            <span className="text-xl sm:text-2xl font-black text-emerald-300 font-mono">
              {batch.totalScannedUnits?.toLocaleString('es-MX') || 0}
            </span>
            <span className="text-[10px] text-emerald-300/80 block mt-0.5">
              {batch.completedItemsCount || 0} partidas completadas
            </span>
          </div>

          <div className="bg-amber-500/10 border border-amber-400/20 rounded-2xl p-3">
            <span className="text-[10px] text-amber-200 uppercase font-black tracking-wider block">
              Faltan por Contar
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
              {batch.totalPendingUnits?.toLocaleString('es-MX') || 0}
            </span>
            <span className="text-[10px] text-amber-300/80 block mt-0.5">
              se van restando en vivo
            </span>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex flex-col justify-between">
            <div className="flex justify-between items-center text-[10px] uppercase font-black text-indigo-200">
              <span>Avance Global</span>
              <span>{progressPct}%</span>
            </div>
            <div className="w-full bg-black/40 h-3 rounded-full overflow-hidden p-0.5 border border-white/20 mt-1">
              <div 
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] text-right text-indigo-300/80 font-mono mt-0.5">
              {batch.status === 'completed' ? '✓ Lote Completo' : 'En proceso'}
            </span>
          </div>
        </div>
      </div>

      {/* NOTIFICACIÓN TOAST FLOTANTE */}
      {notification && (
        <div className={`py-2 px-4 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 shadow-lg transition-all ${
          notification.type === 'success' 
            ? 'bg-emerald-600 text-white' 
            : notification.type === 'warning' 
              ? 'bg-amber-500 text-slate-900' 
              : 'bg-rose-600 text-white'
        }`}>
          <span>{notification.text}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. ZONA DE ESCANEO CON PISTOLA Y MULTIPLICADOR */}
      {/* ======================================================== */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          
          {/* BARRA DE LA PISTOLA LECTORA */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessScan(scanInput);
            }}
            className="flex-1 relative flex items-center"
          >
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-indigo-600 text-base font-bold">
              🔫
            </span>
            <input
              ref={scanInputRef}
              type="text"
              autoComplete="off"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Escanea el código de barras o escribe la clave (ej. 69209523... o IK02392)..."
              className="w-full pl-10 pr-24 py-3 bg-slate-50 border-2 border-indigo-300 focus:border-indigo-600 focus:bg-white focus:ring-4 focus:ring-indigo-100 rounded-2xl text-xs sm:text-sm font-mono font-bold text-slate-900 outline-none transition shadow-2xs uppercase placeholder-slate-400"
            />
            <button
              type="submit"
              className="absolute right-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1 cursor-pointer"
            >
              <span>Contar</span>
              <span className="text-[10px] opacity-75">↵</span>
            </button>
          </form>

          {/* MULTIPLICADOR / CANTIDAD POR ESCANEO ("PONER EL NÚMERO QUE SON Y LEERLO") */}
          <div className="flex items-center gap-2 bg-indigo-50/80 border border-indigo-200 p-2 rounded-2xl shrink-0 flex-wrap">
            <span className="text-[11px] font-black text-indigo-900 uppercase tracking-tight shrink-0">
              Contar por escaneo:
            </span>

            {/* Input de cantidad editable */}
            <div className="flex items-center bg-white rounded-xl border border-indigo-300 px-2 py-1 shadow-2xs">
              <span className="text-xs font-bold text-slate-400 mr-1">x</span>
              <input
                type="number"
                min="1"
                max="10000"
                value={multiplier}
                onChange={(e) => setMultiplier(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-14 text-center font-mono font-black text-indigo-900 text-sm outline-none bg-transparent"
                title="Cantidad a sumar con el siguiente escaneo"
              />
              <span className="text-[10px] font-bold text-slate-500 ml-1">pzas</span>
            </div>

            {/* Botones rápidos de 1 toque */}
            <div className="flex items-center gap-1">
              {[1, 5, 10, 20, 50, 100].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setMultiplier(val)}
                  className={`text-[11px] font-bold px-2 py-1 rounded-lg transition cursor-pointer ${
                    multiplier === val
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white hover:bg-indigo-100 text-indigo-800 border border-indigo-200'
                  }`}
                >
                  +{val}
                </button>
              ))}
            </div>

            {/* Switch para mantener fijo el multiplicador */}
            <label className="flex items-center gap-1.5 ml-1 text-[11px] font-semibold text-indigo-950 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepMultiplier}
                onChange={(e) => setKeepMultiplier(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span>Bloquear cantidad</span>
            </label>
          </div>

        </div>

        {/* COINCIDENCIAS PREDICTIVAS SI ESCRIBE MANUALMENTE */}
        {liveSuggestions.length > 0 && scanInput.trim() && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2 flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase px-1">
              Coincidencias encontradas en este lote (haz clic para contar):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {liveSuggestions.map(sug => (
                <button
                  key={sug.id}
                  type="button"
                  onClick={() => handleProcessScan(sug.code)}
                  className="text-left bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 p-2 rounded-xl transition flex flex-col cursor-pointer"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold text-xs text-indigo-900">{sug.code}</span>
                    <span className="text-[10px] font-mono text-slate-500">{sug.barcode || 'S/N'}</span>
                  </div>
                  <span className="text-[11px] text-slate-700 truncate font-medium mt-0.5">{sug.description}</span>
                  <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                    <span>Recibidas: <strong className="text-slate-800">{sug.scannedQty}/{sug.expectedQty}</strong></span>
                    <span className="text-amber-700 font-bold">Faltan: {sug.pendingQty}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 3. TARJETA DE ÚLTIMO PRODUCTO ESCANEADO (RETROALIMENTACIÓN) */}
        {/* ======================================================== */}
        {activeItem && (
          <div className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
            activeItem.scannedQty >= activeItem.expectedQty
              ? activeItem.scannedQty > activeItem.expectedQty
                ? 'bg-rose-50 border-rose-300 text-rose-950'
                : 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-indigo-50/70 border-indigo-300 text-indigo-950'
          }`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-sm text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                    {activeItem.code}
                  </span>
                  {activeItem.barcode && (
                    <span className="font-mono text-xs text-slate-600 bg-white/80 px-2 py-0.5 rounded-md border border-slate-200">
                      Código: {activeItem.barcode}
                    </span>
                  )}
                  {activeItem.location && activeItem.location !== 'Sin Asignar' && (
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                      <span>📍 Acomodo en:</span>
                      <strong>{activeItem.location}</strong>
                    </span>
                  )}
                </div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-800 mt-1 truncate">
                  {activeItem.description}
                </h4>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Conteo de esta partida
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-black font-mono text-slate-900">
                      {activeItem.scannedQty}
                    </span>
                    <span className="text-xs text-slate-400 font-bold">
                      / {activeItem.expectedQty} esperadas
                    </span>
                  </div>
                </div>

                <div className={`px-3 py-1.5 rounded-xl font-black text-xs uppercase tracking-tight flex items-center gap-1 shadow-2xs ${
                  activeItem.scannedQty >= activeItem.expectedQty
                    ? activeItem.scannedQty > activeItem.expectedQty
                      ? 'bg-rose-600 text-white'
                      : 'bg-emerald-600 text-white'
                    : 'bg-amber-500 text-slate-950'
                }`}>
                  {activeItem.scannedQty >= activeItem.expectedQty ? (
                    activeItem.scannedQty > activeItem.expectedQty ? (
                      <span>⚠️ Excedente (+{activeItem.scannedQty - activeItem.expectedQty})</span>
                    ) : (
                      <span>✓ Completo</span>
                    )
                  ) : (
                    <span>Faltan {activeItem.pendingQty}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 4. TABLA DETALLADA DE PARTIDAS ESTILO HOJA DE CÁLCULO */}
      {/* ======================================================== */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        
        {/* BARRA DE HERRAMIENTAS Y FILTROS */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-700 uppercase">Mostrar:</span>
            {[
              { id: 'ALL', label: 'Todas las Partidas', count: batch.items?.length || 0 },
              { id: 'PENDING', label: 'Con Faltantes', count: batch.items?.filter(it => (it.pendingQty || 0) > 0).length || 0 },
              { id: 'COMPLETED', label: 'Completas al 100%', count: batch.items?.filter(it => it.scannedQty >= it.expectedQty && it.scannedQty <= it.expectedQty).length || 0 },
              { id: 'SURPLUS', label: 'Excedentes', count: batch.items?.filter(it => it.scannedQty > it.expectedQty).length || 0 }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === tab.id
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                  statusFilter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por clave, barcode, modelo..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 focus:border-indigo-500 rounded-xl text-xs font-medium text-slate-800 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* TABLA PRINCIPAL DE PARTIDAS */}
        <div className="overflow-x-auto max-h-[550px] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="text-center py-16 px-4 bg-slate-50/50">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-xl mb-2">
                📦
              </div>
              <p className="text-sm font-bold text-slate-700">No se encontraron partidas</p>
              <p className="text-xs text-slate-500 mt-1">
                Ningún producto coincide con el filtro o término de búsqueda seleccionado.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wider sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[120px]">Clave / Código</th>
                  <th className="py-2.5 px-3 min-w-[140px]">Código de Barras</th>
                  <th className="py-2.5 px-3 min-w-[220px]">Descripción / Modelo</th>
                  <th className="py-2.5 px-3 min-w-[160px]">Ubicación Almacén</th>
                  <th className="py-2.5 px-3 w-20 text-center">Esperadas</th>
                  <th className="py-2.5 px-3 w-20 text-center">Recibidas</th>
                  <th className="py-2.5 px-3 w-24 text-center">FALTAN</th>
                  <th className="py-2.5 px-3 min-w-[120px]">Progreso</th>
                  <th className="py-2.5 px-3 w-28 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredItems.map((item, idx) => {
                  const expected = item.expectedQty || 0;
                  const scanned = item.scannedQty || 0;
                  const pending = item.pendingQty || 0;
                  const isDone = scanned >= expected && expected > 0;
                  const isOver = scanned > expected;
                  const itemPct = expected > 0 ? Math.min(100, Math.round((scanned / expected) * 100)) : 0;
                  const isEditing = editingItemId === item.id;

                  return (
                    <tr 
                      key={item.id || idx}
                      className={`transition-colors group ${
                        isOver
                          ? 'bg-rose-50/40 hover:bg-rose-50/70'
                          : isDone
                          ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                          : scanned > 0
                          ? 'bg-amber-50/20 hover:bg-amber-50/50'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Consecutivo */}
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Clave */}
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-950">
                        {item.code}
                      </td>

                      {/* Código de barras */}
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {item.barcode ? (
                          <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 select-all">
                            {item.barcode}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Descripción */}
                      <td className="py-2.5 px-3 text-slate-800">
                        <div className="truncate max-w-[280px]" title={item.description}>
                          {item.description}
                        </div>
                        {item.forUseIn && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[280px]" title={item.forUseIn}>
                            Uso en: {item.forUseIn}
                          </div>
                        )}
                      </td>

                      {/* Ubicación física */}
                      <td className="py-2.5 px-3 text-slate-700">
                        {item.location && item.location !== 'Sin Asignar' ? (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md text-[11px] font-bold">
                            <span>📍</span>
                            <span>{item.location}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300 italic text-[11px]">Sin Asignar</span>
                        )}
                      </td>

                      {/* Cantidad Esperada */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-600 text-xs">
                        {expected}
                      </td>

                      {/* Cantidad Recibida */}
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-xs">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              min="0"
                              value={editingQtyInput}
                              onChange={(e) => setEditingQtyInput(e.target.value)}
                              className="w-16 px-1.5 py-0.5 border border-indigo-400 rounded text-center text-xs font-bold outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveManualAdjustment(item)}
                              className="text-emerald-700 hover:text-emerald-900 font-black text-xs"
                              title="Guardar ajuste"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingItemId(null)}
                              className="text-slate-400 hover:text-slate-600 text-xs"
                              title="Cancelar"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-md font-mono ${
                            isOver 
                              ? 'bg-rose-100 text-rose-800' 
                              : isDone 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : scanned > 0 
                              ? 'bg-indigo-100 text-indigo-900' 
                              : 'text-slate-400'
                          }`}>
                            {scanned}
                          </span>
                        )}
                      </td>

                      {/* FALTAN (SE VA RESTANDO) */}
                      <td className="py-2.5 px-3 text-center">
                        {isOver ? (
                          <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-900 border border-rose-300 px-2 py-0.5 rounded-md text-[11px] font-black">
                            +{scanned - expected} extra
                          </span>
                        ) : pending === 0 ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-md text-[11px] font-black">
                            ✓ Completo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-950 border border-amber-300 px-2 py-0.5 rounded-md text-[11px] font-black animate-pulse">
                            Faltan {pending}
                          </span>
                        )}
                      </td>

                      {/* Barra de progreso % */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                isOver ? 'bg-rose-500' : isDone ? 'bg-emerald-500' : 'bg-indigo-600'
                              }`}
                              style={{ width: `${itemPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 w-8 text-right">
                            {itemPct}%
                          </span>
                        </div>
                      </td>

                      {/* Acciones */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleProcessScan(item.code)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer"
                            title="Contar +1 pieza"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingItemId(item.id);
                              setEditingQtyInput(String(item.scannedQty || 0));
                            }}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded text-[10px] font-bold transition cursor-pointer"
                            title="Ajustar cantidad manualmente"
                          >
                            ✏️
                          </button>
                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => handleMarkItemComplete(item)}
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded text-[10px] font-bold transition cursor-pointer"
                              title="Marcar partida completa al 100%"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* PIE DE TABLA */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Mostrando <strong>{filteredItems.length}</strong> de <strong>{batch.items?.length || 0}</strong> partidas de consumibles.
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>Completos: {batch.items?.filter(it => it.scannedQty >= it.expectedQty).length || 0}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
              <span>Pendientes: {batch.items?.filter(it => (it.pendingQty || 0) > 0).length || 0}</span>
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}
