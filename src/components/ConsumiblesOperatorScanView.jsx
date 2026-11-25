// src/components/ConsumiblesOperatorScanView.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { ConsumiblesController } from '../controllers/ConsumiblesController.js';
import { ConsumiblesRepository } from '../services/ConsumiblesRepository.js';
import { ConsumiblesChecklistRepository } from '../services/ConsumiblesChecklistRepository.js';
import { soundEffects } from '../utils/soundEffects.js';
import CameraScanner from './CameraScanner.jsx';

export default function ConsumiblesOperatorScanView({
  initialBatchId = null,
  onSelectBatch = null
}) {
  // Modalidad principal del operador: 'RECEPTION' (Recepción de lotes/facturas) o 'CATALOG' (Consulta y auditoría de catálogo)
  const [activeMode, setActiveMode] = useState('RECEPTION');

  // Lotes de consumibles para recepción
  const [consumablesBatches, setConsumablesBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId);
  const [activeBatch, setActiveBatch] = useState(null);
  const [loadingBatches, setLoadingBatches] = useState(true);

  // Filtros de recepción en lote: 'ALL' | 'PENDING' | 'COMPLETED' | 'SURPLUS'
  const [receptionFilter, setReceptionFilter] = useState('ALL');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');

  // Estados de escaneo y captura rápida de recepción por cajas (Multiplicación)
  const [receptionScanInput, setReceptionScanInput] = useState('');
  const [capturingItem, setCapturingItem] = useState(null);
  const [piecesPerBox, setPiecesPerBox] = useState(10);
  const [boxCount, setBoxCount] = useState(1);
  const [directTotalQty, setDirectTotalQty] = useState(10);
  const [barcodeToLinkInput, setBarcodeToLinkInput] = useState('');
  const [scannedBarcodeForLinking, setScannedBarcodeForLinking] = useState('');

  // Alerta de seguridad ante excedente de factura (Idea 2)
  const [surplusWarningData, setSurplusWarningData] = useState(null);

  // Animación visual de confirmación de recepción
  const [receptionSuccessAnimation, setReceptionSuccessAnimation] = useState(null);

  // Modificación de ubicación de partida en recepción
  const [editingItemLocation, setEditingItemLocation] = useState(null);
  const [locationEditInput, setLocationEditInput] = useState('');

  // Estados para modo Catálogo y Ubicaciones
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogScanInput, setCatalogScanInput] = useState('');
  const [activeCatalogItem, setActiveCatalogItem] = useState(null);
  const [unlinkedCode, setUnlinkedCode] = useState(null);
  const [linkingSearch, setLinkingSearch] = useState('');
  const [isEditingCatalogLocation, setIsEditingCatalogLocation] = useState(false);
  const [editSeccion, setEditSeccion] = useState('');
  const [editAnaquel, setEditAnaquel] = useState('');
  const [editEspacio, setEditEspacio] = useState('');
  const [editAlmacen, setEditAlmacen] = useState('Principal');
  const [scanHistory, setScanHistory] = useState([]);

  // Estados generales
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [notification, setNotification] = useState(null);
  const [operatorName, setOperatorName] = useState('Operador');

  const scanInputRef = useRef(null);

  // 1. Cargar lotes de consumibles al montar
  useEffect(() => {
    loadBatchesData();
  }, []);

  const loadBatchesData = async () => {
    setLoadingBatches(true);
    try {
      const batches = await ConsumiblesChecklistRepository.fetchAllConsumablesBatches();
      setConsumablesBatches(batches || []);

      if (batches && batches.length > 0) {
        if (initialBatchId) {
          const found = batches.find(b => String(b.id) === String(initialBatchId));
          if (found) {
            setSelectedBatchId(found.id);
            setActiveBatch(found);
          } else {
            setSelectedBatchId(batches[0].id);
            setActiveBatch(batches[0]);
          }
        } else if (!selectedBatchId) {
          setSelectedBatchId(batches[0].id);
          setActiveBatch(batches[0]);
        } else {
          const found = batches.find(b => String(b.id) === String(selectedBatchId));
          if (found) setActiveBatch(found);
        }
      }
    } catch (e) {
      console.warn('Error cargando lotes de consumibles en modo operador:', e);
    } finally {
      setLoadingBatches(false);
    }
  };

  // 2. Cargar catálogo maestro si el operador cambia a modo catálogo
  useEffect(() => {
    if (activeMode === 'CATALOG' && catalog.length === 0) {
      loadCatalogData();
    }
  }, [activeMode]);

  const loadCatalogData = async () => {
    setLoadingCatalog(true);
    try {
      const items = await ConsumiblesController.loadCatalog();
      setCatalog(items || []);
    } catch (e) {
      console.warn('Error cargando catálogo:', e);
    } finally {
      setLoadingCatalog(false);
    }
  };

  // 3. Autoenfoque constante en el input lector
  useEffect(() => {
    if (!isCameraActive && !capturingItem && !editingItemLocation && !unlinkedCode && !surplusWarningData && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [isCameraActive, capturingItem, editingItemLocation, unlinkedCode, surplusWarningData, activeMode, selectedBatchId]);

  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Sincronizar activeBatch si cambia selectedBatchId
  useEffect(() => {
    if (selectedBatchId && consumablesBatches.length > 0) {
      const found = consumablesBatches.find(b => String(b.id) === String(selectedBatchId));
      if (found) setActiveBatch(found);
    }
  }, [selectedBatchId, consumablesBatches]);

  // Contadores y métricas de partidas del lote activo
  const batchStats = useMemo(() => {
    if (!activeBatch || !activeBatch.items) {
      return { total: 0, pending: 0, completed: 0, surplus: 0, totalExp: 0, totalScanned: 0 };
    }
    const items = activeBatch.items;
    const total = items.length;
    let pending = 0;
    let completed = 0;
    let surplus = 0;
    let totalExp = 0;
    let totalScanned = 0;

    items.forEach(it => {
      const exp = it.expectedQty || 0;
      const rcv = it.scannedQty || 0;
      totalExp += exp;
      totalScanned += rcv;
      if (rcv > exp) surplus++;
      else if (rcv >= exp && exp > 0) completed++;
      else pending++;
    });

    return { total, pending, completed, surplus, totalExp, totalScanned };
  }, [activeBatch]);

  // Lista de partidas del lote activo según el filtro de estatus y búsqueda
  const filteredBatchItems = useMemo(() => {
    if (!activeBatch || !activeBatch.items) return [];
    const q = batchSearchQuery.trim().toLowerCase();
    return activeBatch.items.filter(it => {
      const exp = it.expectedQty || 0;
      const rcv = it.scannedQty || 0;

      // Filtro de estatus
      if (receptionFilter === 'PENDING' && rcv >= exp) return false;
      if (receptionFilter === 'COMPLETED' && (rcv < exp || rcv > exp)) return false;
      if (receptionFilter === 'SURPLUS' && rcv <= exp) return false;

      // Filtro de búsqueda
      if (!q) return true;
      const code = String(it.code || '').toLowerCase();
      const barcode = String(it.barcode || '').toLowerCase();
      const desc = String(it.description || '').toLowerCase();
      const loc = String(it.location || '').toLowerCase();
      return code.includes(q) || barcode.includes(q) || desc.includes(q) || loc.includes(q);
    });
  }, [activeBatch, receptionFilter, batchSearchQuery]);

  // =========================================================================
  // FLUJO DE RECEPCIÓN: ESCANEO Y CAPTURA CÓMODA CON CAJAS
  // =========================================================================

  const handleProcessReceptionScan = async (codeToScan = receptionScanInput) => {
    const raw = String(codeToScan || '').trim();
    if (!raw || !activeBatch) return;

    const query = raw.toUpperCase();
    const queryClean = query.replace(/[^A-Z0-9]/g, '');

    // Buscar coincidencia en el lote
    const items = activeBatch.items || [];
    const matchedItem = items.find(it => {
      if (it.barcode && String(it.barcode).trim() === raw) return true;
      const cleanB = String(it.barcode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanB && cleanB === queryClean) return true;
      const cleanC = String(it.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanC === queryClean) return true;
      const codeUpper = String(it.code || '').toUpperCase();
      if (codeUpper.includes(query) || query.includes(codeUpper)) return true;
      return false;
    });

    if (!matchedItem) {
      soundEffects.playScanError();
      showToast('error', `❌ El código "${raw}" no pertenece al lote activo (${activeBatch.folio}).`);
      setReceptionScanInput('');
      return;
    }

    // Coincidencia exitosa: Abrir de inmediato la tarjeta/modal de captura rápida
    soundEffects.playScanSuccess();
    setCapturingItem(matchedItem);
    setScannedBarcodeForLinking(raw);
    setBarcodeToLinkInput(raw || matchedItem.barcode || '');

    // Calcular cantidad sugerida por defecto de piezas por caja y cajas
    const pending = Math.max(0, (matchedItem.expectedQty || 0) - (matchedItem.scannedQty || 0));
    const defPieces = (pending > 0 && pending <= 5) ? pending : 10;
    const defBoxes = (pending > 0 && defPieces > 0) ? Math.max(1, Math.floor(pending / defPieces)) : 1;
    
    setPiecesPerBox(defPieces);
    setBoxCount(defBoxes);
    setDirectTotalQty(defPieces * defBoxes);
    setReceptionScanInput('');
  };

  // Confirmar y aplicar la cantidad recibida
  const handleConfirmReceptionQuantity = async (forceConfirm = false) => {
    if (!capturingItem || !activeBatch) return;

    const qty = parseInt(directTotalQty, 10);
    if (isNaN(qty) || qty <= 0) {
      alert("Por favor ingresa una cantidad numérica válida mayor a 0.");
      return;
    }

    const currentScanned = capturingItem.scannedQty || 0;
    const expected = capturingItem.expectedQty || 0;
    const newTotal = currentScanned + qty;

    // ALERTA DE SEGURIDAD (IDEA 2): Si la cantidad supera lo facturado y no ha sido confirmada expresamente
    if (!forceConfirm && expected > 0 && newTotal > expected) {
      const surplus = newTotal - expected;
      soundEffects.playScanDuplicate();
      setSurplusWarningData({
        item: capturingItem,
        qtyToIngest: qty,
        boxCount: boxCount,
        piecesPerBox: piecesPerBox,
        currentScanned: currentScanned,
        expected: expected,
        newTotal: newTotal,
        surplus: surplus,
        barcodeFinal: (barcodeToLinkInput || scannedBarcodeForLinking || capturingItem.barcode || '').trim()
      });
      return;
    }

    // Si procedió o fue forzado por el operador, cerramos el modal de advertencia de excedente
    setSurplusWarningData(null);

    const barcodeFinal = (barcodeToLinkInput || scannedBarcodeForLinking || capturingItem.barcode || '').trim();

    // 1. AUTO-VINCULAR DE FORMA PERMANENTE EL CÓDIGO DE BARRAS AL PRODUCTO EN EL CATÁLOGO MAESTRO
    if (barcodeFinal && capturingItem.code) {
      try {
        await ConsumiblesRepository.linkBarcodeToConsumible(barcodeFinal, capturingItem.code);
      } catch (e) {
        console.warn('Nota auto-vinculación:', e);
      }
    }

    // 2. Registrar escaneo con la cantidad total calculada en el checklist
    const codeToSubmit = barcodeFinal || capturingItem.code;
    const result = await ConsumiblesChecklistRepository.recordScan(
      activeBatch.id,
      codeToSubmit,
      qty,
      operatorName
    );

    if (!result.success) {
      soundEffects.playScanError();
      showToast('error', result.message || 'Error al registrar la recepción.');
      return;
    }

    // 3. Sonido y notificación
    if (result.isSurplus) {
      soundEffects.playScanDuplicate();
      showToast('warning', `⚠️ ¡Excedente! Se ingresaron +${qty} pzas (${boxCount} cajas × ${piecesPerBox} pzas) de ${capturingItem.code}.`);
    } else if (result.isItemCompleted) {
      soundEffects.playScanSuccess();
      showToast('success', `🎉 ¡Partida completada! ${capturingItem.code} (+${qty} pzas, ${boxCount} cajas × ${piecesPerBox} pzas). Barcode ${barcodeFinal || ''} ligado ✓`);
    } else {
      soundEffects.playScanSuccess();
      showToast('success', `✓ +${qty} pzas recibidas (${boxCount} cajas × ${piecesPerBox} pzas) de ${capturingItem.code}. Faltan ${result.item.pendingQty} pzas. Código ligado ✓`);
    }

    // Disparar animación visual prominente de confirmación
    setReceptionSuccessAnimation({
      code: capturingItem.code,
      description: capturingItem.description,
      qtyAdded: qty,
      boxCount: boxCount,
      piecesPerBox: piecesPerBox,
      barcode: barcodeFinal,
      isCompleted: result.isItemCompleted,
      isSurplus: result.isSurplus,
      pendingQty: result.item.pendingQty,
      scannedQty: result.item.scannedQty,
      expectedQty: result.item.expectedQty,
      location: capturingItem.location || 'Sin Asignar'
    });

    setActiveBatch(result.batch);
    setConsumiblesBatches(prev => prev.map(b => b.id === result.batch.id ? result.batch : b));
    setCapturingItem(null);
    setScannedBarcodeForLinking('');
    setBarcodeToLinkInput('');

    if (scanInputRef.current) scanInputRef.current.focus();
  };

  // Auto-cerrar animación de recepción después de 2.2 segundos
  useEffect(() => {
    if (receptionSuccessAnimation) {
      const timer = setTimeout(() => {
        setReceptionSuccessAnimation(null);
      }, 2300);
      return () => clearTimeout(timer);
    }
  }, [receptionSuccessAnimation]);

  // Modificar la ubicación de una partida en el checklist (marca AMARILLA o VERDE)
  const handleSaveItemLocation = async (item, isVerifiedOk = false) => {
    if (!item || !activeBatch) return;
    const newLoc = isVerifiedOk ? (item.location || 'Sin Asignar') : locationEditInput.trim().toUpperCase();
    if (!newLoc) return;

    const res = await ConsumiblesChecklistRepository.updateItemLocation(
      activeBatch.id,
      item.id,
      newLoc,
      isVerifiedOk,
      item.location,
      operatorName
    );

    // Sincronizar de inmediato con el Catálogo Maestro de consumibles
    try {
      const parts = newLoc.split(/[\s\[\]-]+/).filter(Boolean);
      await ConsumiblesRepository.updateConsumibleLocation(item.code, {
        seccion: parts[0] || newLoc,
        anaquel: parts[1] || '',
        espacio: parts[2] || '',
        almacen: 'Principal'
      }, operatorName);
      loadCatalogData();
    } catch (e) {}

    if (res?.batch) {
      setActiveBatch(res.batch);
      setConsumiblesBatches(prev => prev.map(b => b.id === res.batch.id ? res.batch : b));
      soundEffects.playScanSuccess();

      if (isVerifiedOk) {
        showToast('success', `✓ Ubicación verificada correcta: ${newLoc} (Marcada VERDE en Excel)`);
      } else {
        showToast('warning', `⚠️ ¡Ubicación modificada a ${newLoc}! (Marcada AMARILLA en Excel y registrada en pestaña de movimientos)`);
      }
    }

    setEditingItemLocation(null);
    setLocationEditInput('');
  };

  // Exportar Excel oficial del lote
  const handleExportBatchExcel = () => {
    if (!activeBatch) return;
    ConsumiblesChecklistRepository.exportChecklistToExcel(activeBatch);
  };

  // =========================================================================
  // FLUJO DE CATÁLOGO GENERAL Y AUDITORÍA DE UBICACIÓN
  // =========================================================================

  const handleSelectProductCatalog = (item) => {
    soundEffects.playScanSuccess();
    setActiveCatalogItem(item);
    setUnlinkedCode(null);
    setCatalogScanInput('');
    setIsEditingCatalogLocation(false);
    setEditSeccion(item.seccion || '');
    setEditAnaquel(item.anaquel || '');
    setEditEspacio(item.espacio || '');
    setEditAlmacen(item.almacen || 'Principal');
    showToast('success', `✓ Ubicación: ${item.seccion || 'S/N'} [Anaquel: ${item.anaquel || 'S/N'}]`);

    setScanHistory(prev => [
      {
        item,
        status: item.locationStatus || 'UNCHECKED',
        wasChanged: item.locationStatus === 'RELOCATED',
        timestamp: new Date().toLocaleTimeString('es-MX', { hour12: true }),
        operator: operatorName
      },
      ...prev.filter(h => h.item.id !== item.id)
    ].slice(0, 30));
  };

  const handleConfirmLocationOkCatalog = async (item) => {
    if (!item) return;
    soundEffects.playScanSuccess();
    try {
      const result = await ConsumiblesController.updateLocation(item.id, {
        seccion: item.seccion,
        anaquel: item.anaquel,
        espacio: item.espacio,
        almacen: item.almacen
      }, operatorName);

      const verified = result.item || { ...item, locationStatus: 'VERIFIED_OK' };
      setActiveCatalogItem(verified);
      setCatalog(prev => prev.map(c => c.id === item.id ? verified : c));
      showToast('success', `✓ Ubicación confirmada: Todo en orden (${item.seccion || 'S/N'} [${item.anaquel || 'S/N'}])`);
    } catch {
      showToast('error', 'Error al confirmar la ubicación.');
    }
  };

  const handleSaveModifiedLocationCatalog = async () => {
    if (!activeCatalogItem) return;
    try {
      const result = await ConsumiblesController.updateLocation(activeCatalogItem.id, {
        seccion: editSeccion.trim().toUpperCase(),
        anaquel: editAnaquel.trim().toUpperCase(),
        espacio: editEspacio.trim().toUpperCase(),
        almacen: editAlmacen.trim()
      }, operatorName);

      const updated = result.item || activeCatalogItem;
      setActiveCatalogItem(updated);
      setCatalog(prev => prev.map(c => c.id === activeCatalogItem.id ? updated : c));
      setIsEditingCatalogLocation(false);
      soundEffects.playScanSuccess();

      // Sincronizar también con el lote de recepción activo si este item pertenece a él
      if (activeBatch && Array.isArray(activeBatch.items)) {
        const itemInBatch = activeBatch.items.find(
          it => String(it.code).trim().toUpperCase() === String(updated.clave).trim().toUpperCase()
        );
        if (itemInBatch) {
          const newLocStr = `${updated.seccion || ''} [${updated.anaquel || ''} - ${updated.espacio || ''}]`.trim();
          const batchRes = await ConsumiblesChecklistRepository.updateItemLocation(
            activeBatch.id,
            itemInBatch.id,
            newLocStr,
            !result.wasChanged,
            itemInBatch.location,
            operatorName
          );
          if (batchRes?.batch) {
            setActiveBatch(batchRes.batch);
            setConsumiblesBatches(prev => prev.map(b => b.id === batchRes.batch.id ? batchRes.batch : b));
          }
        }
      }

      if (result.wasChanged) {
        showToast('warning', `⚠️ ¡Ubicación reasignada! Se cambió a ${updated.seccion} [${updated.anaquel} - ${updated.espacio}] (Registrada en pestaña de movimientos y marcada amarillo en Excel)`);
      } else {
        showToast('success', `✓ Misma ubicación guardada y confirmada.`);
      }
    } catch {
      showToast('error', 'Error al modificar la ubicación.');
    }
  };

  const handleProcessCatalogScan = (code) => {
    if (!code || !code.trim()) return;
    const query = code.trim();
    const predictiveMatches = ConsumiblesController.searchPredictive(query, catalog, 20);

    const exactClaveMatch = predictiveMatches.find(
      m => String(m.clave || '').trim().toUpperCase() === query.toUpperCase()
    );
    if (exactClaveMatch) {
      handleSelectProductCatalog(exactClaveMatch);
      return;
    }

    const exactBarcodeMatch = catalog.find(
      it => Array.isArray(it.barcodes) && it.barcodes.includes(query)
    );
    if (exactBarcodeMatch) {
      handleSelectProductCatalog(exactBarcodeMatch);
      return;
    }

    if (predictiveMatches.length === 1) {
      handleSelectProductCatalog(predictiveMatches[0]);
      return;
    }

    // Código nuevo sin registrar
    soundEffects.playScanError();
    setUnlinkedCode(query);
    setLinkingSearch('');
    showToast('warning', `El código "${query}" no está en el catálogo. Puedes vincularlo a continuación.`);
  };

  return (
    <div className="flex flex-col gap-4 text-slate-100 max-w-4xl mx-auto w-full animate-in fade-in">
      
      {/* NOTIFICACIÓN FLOTANTE */}
      {notification && (
        <div className={`p-3.5 rounded-2xl shadow-xl flex items-center justify-between gap-3 text-xs font-bold transition-all border ${
          notification.type === 'success' ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200' :
          notification.type === 'warning' ? 'bg-amber-950/90 border-amber-500 text-amber-200' :
          'bg-rose-950/90 border-rose-500 text-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            <span>{notification.type === 'success' ? '✓' : notification.type === 'warning' ? '⚠️' : '✕'}</span>
            <span>{notification.text}</span>
          </div>
          <button type="button" onClick={() => setNotification(null)} className="text-white/60 hover:text-white">✕</button>
        </div>
      )}

      {/* SELECTOR DE MODO SUPERIOR (RECEPCIÓN vs CATÁLOGO) */}
      <div className="bg-slate-900/90 p-2 rounded-2xl border border-slate-800 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-1.5 flex-1">
          <button
            type="button"
            onClick={() => {
              setActiveMode('RECEPTION');
              setCapturingItem(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMode === 'RECEPTION'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-300 hover:text-white bg-slate-800/60'
            }`}
          >
            <span>📥</span>
            <span>Recepción de Lotes</span>
            <span className="bg-purple-950 text-purple-200 text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-1">
              {consumablesBatches.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveMode('CATALOG');
              setCapturingItem(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMode === 'CATALOG'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-blue-300 hover:text-white bg-slate-800/60'
            }`}
          >
            <span>🏷️</span>
            <span>Catálogo y Ubicaciones</span>
          </button>
        </div>

        {/* Nombre del Operador */}
        <div className="hidden sm:flex items-center gap-1 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-[11px] font-bold">
          <span className="text-slate-400">👤</span>
          <input
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            className="w-20 bg-transparent text-white font-bold outline-none text-[11px]"
            title="Nombre del operador para auditoría"
          />
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: MODO RECEPCIÓN DE LOTES / CHECKLISTS CON PISTOLA Y CAJAS */}
      {/* ========================================================================= */}
      {activeMode === 'RECEPTION' && (
        <div className="flex flex-col gap-4">

          {/* SELECTOR / ENCABEZADO DEL LOTE ACTIVO */}
          {activeBatch ? (
            <div className="bg-slate-900/95 border-2 border-purple-600/50 rounded-3xl p-4 shadow-xl flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-purple-600 text-white font-mono font-black text-xs px-2.5 py-0.5 rounded-lg shadow-xs">
                      {activeBatch.folio}
                    </span>
                    <h2 className="text-sm sm:text-base font-black text-white truncate max-w-sm">
                      {activeBatch.cleanName || activeBatch.name}
                    </h2>
                    {activeBatch.invoiceNumber && (
                      <span className="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-700">
                        Factura: {activeBatch.invoiceNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                    <span>Proveedor: <strong className="text-slate-300">{activeBatch.supplierName || 'Zhejiang Besda'}</strong></span>
                    <span>•</span>
                    <span>Total partidas: <strong className="text-purple-300">{batchStats.total} SKUs</strong></span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportBatchExcel}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                    title="Descargar Excel oficial con marcas de reubicación y pestaña de movimientos"
                  >
                    <span>📥</span>
                    <span className="hidden sm:inline">Excel Lote y Movimientos</span>
                  </button>

                  {consumablesBatches.length > 1 && (
                    <select
                      value={selectedBatchId}
                      onChange={(e) => {
                        setSelectedBatchId(e.target.value);
                        if (onSelectBatch) onSelectBatch(e.target.value);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-xl outline-none cursor-pointer"
                    >
                      {consumablesBatches.map(b => (
                        <option key={b.id} value={b.id}>{b.folio} - {b.cleanName || b.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* BARRA DE PROGRESO DE UNIDADES */}
              <div className="flex flex-col gap-1.5 bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Progreso Físico de Recepción:
                  </span>
                  <span className="font-mono text-emerald-400">
                    {batchStats.totalScanned} de {batchStats.totalExp} pzas ({batchStats.totalExp > 0 ? Math.round((batchStats.totalScanned / batchStats.totalExp) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, batchStats.totalExp > 0 ? (batchStats.totalScanned / batchStats.totalExp) * 100 : 0)}%` }}
                  />
                </div>
              </div>

              {/* FILTROS TIPO PESTAÑAS: TODAS, FALTANTES, COMPLETAS, EXCEDENTES */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setReceptionFilter('ALL')}
                  className={`py-2 px-2 rounded-xl text-[11px] font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${
                    receptionFilter === 'ALL'
                      ? 'bg-slate-800 text-white border border-slate-600 shadow-sm'
                      : 'bg-slate-950/60 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Todas</span>
                  <span className="bg-slate-700 text-slate-200 text-[10px] px-1.5 rounded-full font-bold">
                    {batchStats.total}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setReceptionFilter('PENDING')}
                  className={`py-2 px-2 rounded-xl text-[11px] font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${
                    receptionFilter === 'PENDING'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-slate-950/60 text-amber-300 hover:text-white'
                  }`}
                >
                  <span>Faltantes</span>
                  <span className="bg-amber-950 text-amber-200 text-[10px] px-1.5 rounded-full font-bold">
                    {batchStats.pending}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setReceptionFilter('COMPLETED')}
                  className={`py-2 px-2 rounded-xl text-[11px] font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${
                    receptionFilter === 'COMPLETED'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-950/60 text-emerald-300 hover:text-white'
                  }`}
                >
                  <span>Completas</span>
                  <span className="bg-emerald-950 text-emerald-200 text-[10px] px-1.5 rounded-full font-bold">
                    {batchStats.completed}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setReceptionFilter('SURPLUS')}
                  className={`py-2 px-2 rounded-xl text-[11px] font-black transition flex flex-col sm:flex-row items-center justify-center gap-1 cursor-pointer ${
                    receptionFilter === 'SURPLUS'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-slate-950/60 text-purple-300 hover:text-white'
                  }`}
                >
                  <span>Excedentes</span>
                  <span className="bg-purple-950 text-purple-200 text-[10px] px-1.5 rounded-full font-bold">
                    {batchStats.surplus}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 text-center flex flex-col items-center gap-3">
              <span className="text-4xl">📦</span>
              <h3 className="text-base font-bold text-white">No hay lotes de consumibles activos</h3>
              <p className="text-xs text-slate-400 max-w-md">
                Sube una factura o checklist de consumibles en la pantalla de Oficina para iniciar la recepción con pistola lectora.
              </p>
              <button
                type="button"
                onClick={loadBatchesData}
                className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
              >
                🔄 Actualizar Lotes
              </button>
            </div>
          )}

          {/* BARRA DE ENTRADA CON PISTOLA LECTORA */}
          {activeBatch && (
            <div className="bg-slate-900/90 p-4 rounded-3xl border border-slate-800 shadow-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-200 uppercase tracking-wide flex items-center gap-2">
                  <span className="text-purple-400">🔫</span>
                  <span>Disparar Pistola / Escanear Código o Barcode:</span>
                </label>
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                  Listo para lectura continua
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  ref={scanInputRef}
                  type="text"
                  autoComplete="off"
                  placeholder="ESCANEA CON LA PISTOLA EL CÓDIGO DE BARRAS O ESCRIBE LA CLAVE..."
                  value={receptionScanInput}
                  onChange={(e) => setReceptionScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessReceptionScan(receptionScanInput);
                    }
                  }}
                  className="flex-1 bg-slate-950 border-2 border-purple-500/80 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/30 rounded-2xl px-4 py-3 text-sm font-mono font-black text-white uppercase outline-none placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={() => handleProcessReceptionScan(receptionScanInput)}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-black px-5 rounded-2xl text-xs transition active:scale-95 cursor-pointer shadow-md"
                >
                  OK
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsCameraActive(!isCameraActive)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-2xl flex items-center justify-center gap-2 text-xs transition border border-slate-700"
              >
                <span>📷</span>
                <span>{isCameraActive ? 'Cerrar Cámara' : 'Abrir Cámara con Lector de Barras'}</span>
              </button>
            </div>
          )}

          {/* VISOR DE CÁMARA */}
          {isCameraActive && (
            <div className="bg-slate-950 p-2 rounded-3xl border border-slate-800 overflow-hidden">
              <CameraScanner
                initialBurstMode={false}
                onScan={(code) => {
                  setIsCameraActive(false);
                  handleProcessReceptionScan(code);
                }}
                onClose={() => setIsCameraActive(false)}
              />
            </div>
          )}

          {/* ===================================================================== */}
          {/* MODAL / CARD DE CAPTURA RÁPIDA: ESPACIO PARA CANTIDAD + BOTONES DE CAJAS */}
          {/* ===================================================================== */}
          {capturingItem && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-in fade-in">
              <div className="bg-slate-900 border-2 border-purple-500 w-full max-w-lg rounded-3xl p-5 shadow-2xl flex flex-col gap-4 text-white animate-in zoom-in-95">
                
                {/* ENCABEZADO DEL PRODUCTO */}
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="min-w-0">
                    <span className="bg-purple-600/40 text-purple-200 border border-purple-500/50 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">
                      Partida #{capturingItem.rowNumber || 1}
                    </span>
                    <h3 className="text-base font-black text-white mt-1 leading-snug">
                      {capturingItem.description || capturingItem.code}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                      <span className="bg-slate-800 font-mono font-bold text-amber-300 px-2 py-0.5 rounded-md">
                        Clave: {capturingItem.code}
                      </span>
                      {capturingItem.barcode && (
                        <span className="bg-slate-800 font-mono text-slate-300 px-2 py-0.5 rounded-md">
                          Barcode: {capturingItem.barcode}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCapturingItem(null);
                      setScannedBarcodeForLinking('');
                    }}
                    className="text-slate-400 hover:text-white font-bold text-lg p-1"
                  >
                    ✕
                  </button>
                </div>

                {/* UBICACIÓN FÍSICA EN ALMACÉN Y ESTADO ACTUAL */}
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Ubicación en Almacén:</span>
                    <p className="font-bold text-emerald-400 text-sm mt-0.5 flex items-center gap-1.5">
                      <span>📍</span>
                      <span>{capturingItem.location || 'Sin Asignar'}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Recibidas / Esperadas:</span>
                    <p className="font-mono font-bold text-sm text-purple-300 mt-0.5">
                      {capturingItem.scannedQty || 0} / {capturingItem.expectedQty || 0} pzas
                    </p>
                    <span className="text-[10px] text-amber-400 font-bold">
                      Faltan: {Math.max(0, (capturingItem.expectedQty || 0) - (capturingItem.scannedQty || 0))} pzas
                    </span>
                  </div>
                </div>

                {/* CÓDIGO DE BARRAS QUE SE LIGARÁ PERMANENTEMENTE AL PRODUCTO */}
                <div className="bg-purple-950/40 p-3 rounded-2xl border border-purple-800/60 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black text-purple-200 uppercase flex items-center gap-1.5">
                      <span>🔗</span>
                      <span>Código de Barras a vincular:</span>
                    </label>
                    <span className="text-[10px] text-emerald-400 font-bold">
                      Se ligará de por vida a {capturingItem.code}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={barcodeToLinkInput}
                    onChange={(e) => setBarcodeToLinkInput(e.target.value.trim())}
                    placeholder="Escanear o escribir código de barras..."
                    className="w-full bg-slate-950 border border-purple-500/80 rounded-xl px-3 py-1.5 font-mono font-bold text-xs text-white outline-none focus:border-emerald-400"
                  />
                  <p className="text-[10px] text-slate-400">
                    Al confirmar, este código quedará asociado permanentemente a este consumible para no tener que ligarlo uno por uno al acomodar.
                  </p>
                </div>

                {/* ================================================================ */}
                {/* CÁLCULO POR MULTIPLICACIÓN: CANTIDAD × NÚMERO DE CAJAS */}
                {/* ================================================================ */}
                <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800 flex flex-col gap-3.5">
                  
                  {/* FILA 1: CANTIDAD DE PIEZAS POR CAJA */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-200 uppercase flex items-center gap-1.5">
                        <span className="text-purple-400">📦</span>
                        <span>Piezas por cada caja (Cantidad):</span>
                      </label>
                      <span className="text-[11px] font-mono font-bold text-purple-300">
                        {piecesPerBox} pzas/caja
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={piecesPerBox}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setPiecesPerBox(val);
                          setDirectTotalQty(val * boxCount);
                        }}
                        className="flex-1 bg-slate-900 border-2 border-slate-700 focus:border-purple-400 rounded-xl py-2 px-3 text-center font-mono text-lg font-black text-white outline-none"
                      />
                    </div>

                    {/* Botones rápidos de piezas por caja */}
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 5, 10, 12, 15, 20, 25, 50, 100].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            setPiecesPerBox(n);
                            setDirectTotalQty(n * boxCount);
                          }}
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                            piecesPerBox === n
                              ? 'bg-purple-600 text-white border-purple-400 shadow-xs'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                          }`}
                        >
                          {n} {n === 1 ? 'pza' : 'pzas'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* FILA 2: NÚMERO DE CAJAS QUE LLEGARON */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-200 uppercase flex items-center gap-1.5">
                        <span className="text-amber-400">🔢</span>
                        <span>Número de cajas que llegaron:</span>
                      </label>
                      <span className="text-[11px] font-mono font-bold text-amber-300">
                        {boxCount} {boxCount === 1 ? 'caja' : 'cajas'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const val = Math.max(1, boxCount - 1);
                          setBoxCount(val);
                          setDirectTotalQty(piecesPerBox * val);
                        }}
                        className="w-10 h-10 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black text-base rounded-xl flex items-center justify-center transition active:scale-95 cursor-pointer"
                      >
                        -1
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={boxCount}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setBoxCount(val);
                          setDirectTotalQty(piecesPerBox * val);
                        }}
                        className="flex-1 bg-slate-900 border-2 border-slate-700 focus:border-amber-400 rounded-xl py-2 px-3 text-center font-mono text-lg font-black text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = boxCount + 1;
                          setBoxCount(val);
                          setDirectTotalQty(piecesPerBox * val);
                        }}
                        className="w-10 h-10 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black text-base rounded-xl flex items-center justify-center transition active:scale-95 cursor-pointer"
                      >
                        +1
                      </button>
                    </div>

                    {/* Botones rápidos de número de cajas */}
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 50].map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            setBoxCount(c);
                            setDirectTotalQty(piecesPerBox * c);
                          }}
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                            boxCount === c
                              ? 'bg-amber-600 text-white border-amber-400 shadow-xs'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                          }`}
                        >
                          {c} {c === 1 ? 'caja' : 'cajas'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* MULTIPLICACIÓN Y TOTAL FINAL CALCULADO */}
                  <div className="bg-gradient-to-r from-purple-950/80 via-slate-900 to-emerald-950/80 p-3.5 rounded-2xl border-2 border-purple-500/70 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-300 uppercase text-[10px]">
                        Fórmula de cálculo:
                      </span>
                      <span className="font-mono font-black text-xs text-purple-200">
                        {piecesPerBox} pzas × {boxCount} cajas = {piecesPerBox * boxCount} pzas
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-black text-emerald-300 uppercase block">
                          Total de piezas a ingresar:
                        </span>
                        <span className="text-[10px] text-slate-400">
                          (Modificable directamente si hay piezas sueltas)
                        </span>
                      </div>

                      <div className="w-32">
                        <input
                          type="number"
                          min="1"
                          value={directTotalQty}
                          onChange={(e) => setDirectTotalQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="w-full bg-slate-950 border-2 border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 rounded-xl py-1.5 px-3 text-center font-mono text-2xl font-black text-emerald-300 outline-none"
                        />
                      </div>
                    </div>

                    {/* Botón rápido para tomar todo el faltante */}
                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = Math.max(1, (capturingItem.expectedQty || 0) - (capturingItem.scannedQty || 0));
                          setDirectTotalQty(remaining);
                          if (piecesPerBox > 0) {
                            setBoxCount(Math.max(1, Math.ceil(remaining / piecesPerBox)));
                          }
                        }}
                        className="text-[11px] bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-600 px-3 py-1 rounded-xl font-bold transition cursor-pointer flex items-center gap-1"
                      >
                        <span>🎯</span>
                        <span>Completar Faltante Exacto ({Math.max(0, (capturingItem.expectedQty || 0) - (capturingItem.scannedQty || 0))} pzas)</span>
                      </button>
                    </div>
                  </div>

                </div>

                {/* ACCIONES FINALES */}
                <div className="flex gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setCapturingItem(null);
                      setScannedBarcodeForLinking('');
                      setBarcodeToLinkInput('');
                    }}
                    className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-2xl text-xs transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmReceptionQuantity(false)}
                    className="flex-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl text-xs transition shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                  >
                    <span>✓</span>
                    <span>Confirmar Recepción (+{directTotalQty} pzas)</span>
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* MODAL DE ALERTA DE EXCEDENTE DE FACTURA (IDEA 2) */}
          {/* ===================================================================== */}
          {surplusWarningData && (
            <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in">
              <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/40 border-2 border-amber-500 w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 text-white animate-in zoom-in-95">
                
                {/* ENCABEZADO DE ADVERTENCIA */}
                <div className="flex items-start gap-3 border-b border-amber-500/30 pb-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0">
                    ⚠️
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      Control de Recepción de Proveedores
                    </span>
                    <h3 className="text-lg font-black text-amber-400 mt-1 leading-snug">
                      Alerta de Excedente: Supera la Factura
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      La cantidad ingresada excede el total estipulado en la orden/factura.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSurplusWarningData(null)}
                    className="text-slate-400 hover:text-white font-bold text-lg p-1"
                  >
                    ✕
                  </button>
                </div>

                {/* DETALLE DEL PRODUCTO */}
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-black text-amber-300 text-xs bg-slate-900 px-2 py-0.5 rounded-md border border-slate-700">
                      {surplusWarningData.item.code}
                    </span>
                    <span className="text-[11px] text-emerald-400 font-bold">
                      📍 {surplusWarningData.item.location || 'Sin Asignar'}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white mt-1.5 leading-snug">
                    {surplusWarningData.item.description || surplusWarningData.item.code}
                  </h4>
                </div>

                {/* COMPARATIVA DE CANTIDADES */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">📄 Facturado / Esperado</span>
                    <span className="font-mono font-black text-lg text-white mt-0.5 block">
                      {surplusWarningData.expected} <span className="text-xs font-normal text-slate-400">pzas</span>
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">📦 Ya Recibido Previo</span>
                    <span className="font-mono font-black text-lg text-slate-300 mt-0.5 block">
                      {surplusWarningData.currentScanned} <span className="text-xs font-normal text-slate-400">pzas</span>
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-2xl border border-amber-500/30">
                    <span className="text-[10px] text-amber-400 uppercase font-bold block">➕ Ingresando Ahora</span>
                    <span className="font-mono font-black text-lg text-amber-300 mt-0.5 block">
                      +{surplusWarningData.qtyToIngest} <span className="text-xs font-normal text-amber-400/80">pzas</span>
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      ({surplusWarningData.boxCount} cajas × {surplusWarningData.piecesPerBox} pzas)
                    </span>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-2xl border border-purple-500/30">
                    <span className="text-[10px] text-purple-300 uppercase font-bold block">📊 Nuevo Total</span>
                    <span className="font-mono font-black text-lg text-purple-200 mt-0.5 block">
                      {surplusWarningData.newTotal} <span className="text-xs font-normal text-purple-400/80">pzas</span>
                    </span>
                  </div>
                </div>

                {/* BANNER DESTACADO DE EXCEDENTE */}
                <div className="bg-amber-500/15 border-2 border-amber-500/50 rounded-2xl p-3 text-center">
                  <div className="font-mono font-black text-base text-amber-300 flex items-center justify-center gap-2">
                    <span>🚨</span>
                    <span>EXCEDENTE DETECTADO: +{surplusWarningData.surplus} PIEZAS DE MÁS</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1">
                    ¿El proveedor envió producto de más o hubo un error al capturar cajas/piezas?
                  </p>
                </div>

                {/* BOTONES DE DECISIÓN */}
                <div className="flex gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSurplusWarningData(null)}
                    className="flex-1 py-3 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-2xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>✏️</span>
                    <span>Corregir Cantidad</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmReceptionQuantity(true)}
                    className="flex-1 py-3 px-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-black rounded-2xl text-xs transition shadow-lg shadow-amber-600/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                  >
                    <span>✓</span>
                    <span>Confirmar Excedente (+{surplusWarningData.surplus} pzas)</span>
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* ANIMACIÓN / OVERLAY VISUAL DE CONFIRMACIÓN DE RECEPCIÓN */}
          {/* ===================================================================== */}
          {receptionSuccessAnimation && (
            <div 
              onClick={() => setReceptionSuccessAnimation(null)}
              className="fixed inset-0 z-60 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200 cursor-pointer"
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                className={`w-full max-w-md rounded-3xl p-6 sm:p-8 shadow-2xl text-center relative overflow-hidden border-2 animate-in zoom-in-95 duration-200 ${
                  receptionSuccessAnimation.isSurplus 
                    ? 'bg-gradient-to-b from-amber-950/90 to-slate-950 border-amber-500/60' 
                    : receptionSuccessAnimation.isCompleted
                    ? 'bg-gradient-to-b from-emerald-950/90 to-slate-950 border-emerald-400'
                    : 'bg-gradient-to-b from-slate-900 to-slate-950 border-emerald-500/60'
                }`}
              >
                {/* Círculo animado con Checkmark y rebote */}
                <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
                  <div className={`absolute inset-0 rounded-full animate-ping opacity-25 ${
                    receptionSuccessAnimation.isSurplus ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl font-black text-white shadow-2xl relative z-10 transition-transform ${
                    receptionSuccessAnimation.isSurplus 
                      ? 'bg-amber-600 shadow-amber-500/40' 
                      : receptionSuccessAnimation.isCompleted
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/50'
                      : 'bg-emerald-600 shadow-emerald-500/40'
                  }`}>
                    {receptionSuccessAnimation.isSurplus ? '⚠️' : '✓'}
                  </div>
                </div>

                {/* Cantidad recibida en grande */}
                <h2 className="text-2xl sm:text-3xl font-black text-white mt-4 tracking-tight">
                  +{receptionSuccessAnimation.qtyAdded} Piezas Recibidas
                </h2>

                {/* Fórmula visual de multiplicación de cajas */}
                <div className="mt-2.5 inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-2xl py-1.5 px-4 font-mono font-bold text-emerald-300 text-xs">
                  <span>📦 {receptionSuccessAnimation.boxCount} {receptionSuccessAnimation.boxCount === 1 ? 'caja' : 'cajas'}</span>
                  <span>×</span>
                  <span>{receptionSuccessAnimation.piecesPerBox} pzas/caja</span>
                  <span>=</span>
                  <span className="text-white font-black">{receptionSuccessAnimation.qtyAdded} pzas</span>
                </div>

                {/* Producto y clave */}
                <div className="mt-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black px-2 py-0.5 rounded-md font-mono">
                      {receptionSuccessAnimation.code}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      📍 {receptionSuccessAnimation.location}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white mt-1.5 line-clamp-2">
                    {receptionSuccessAnimation.description || receptionSuccessAnimation.code}
                  </p>

                  {/* Estado de avance de la partida */}
                  <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Progreso en Checklist:</span>
                    <span className="font-mono font-bold text-white">
                      {receptionSuccessAnimation.scannedQty} / {receptionSuccessAnimation.expectedQty} pzas
                    </span>
                  </div>
                </div>

                {/* Badges de confirmación del sistema */}
                <div className="mt-4 flex flex-col gap-1.5 text-[11px] text-left">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-800/40 rounded-xl px-3 py-1.5">
                    <span>✓</span>
                    <span>Sumado automáticamente a existencias maestras</span>
                  </div>
                  {receptionSuccessAnimation.barcode && (
                    <div className="flex items-center gap-2 text-blue-300 font-bold bg-blue-950/40 border border-blue-800/40 rounded-xl px-3 py-1.5 font-mono">
                      <span>🏷️</span>
                      <span>Código de barras ({receptionSuccessAnimation.barcode}) vinculado</span>
                    </div>
                  )}
                </div>

                {/* Botón de cerrar rápido */}
                <button
                  type="button"
                  onClick={() => setReceptionSuccessAnimation(null)}
                  className="mt-5 w-full py-2.5 px-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Continuar Escaneando (Enter / Clic)
                </button>
              </div>
            </div>
          )}

          {/* ===================================================================== */}
          {/* MODAL PARA CAMBIAR UBICACIÓN DE PARTIDA (MARCA AMARILLA / VERDE) */}
          {/* ===================================================================== */}
          {editingItemLocation && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-5 shadow-2xl flex flex-col gap-4 text-white">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📍</span>
                    <h3 className="text-sm font-black text-white">Auditoría / Cambio de Posición</h3>
                  </div>
                  <button type="button" onClick={() => setEditingItemLocation(null)} className="text-slate-400 hover:text-white">✕</button>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
                  <p className="text-slate-400 font-sans font-bold text-[10px]">Producto:</p>
                  <p className="font-sans font-bold text-white text-xs">{editingItemLocation.description || editingItemLocation.code}</p>
                  <p className="text-slate-400 font-sans font-bold text-[10px] mt-1">Ubicación Registrada:</p>
                  <p className="font-bold text-amber-300">{editingItemLocation.location || 'Sin Asignar'}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-300">
                    Nueva Posición en Almacén (ej. GAMA B03 02):
                  </label>
                  <input
                    type="text"
                    value={locationEditInput}
                    onChange={(e) => setLocationEditInput(e.target.value.toUpperCase())}
                    placeholder="Escribe la nueva ubicación..."
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white uppercase outline-none focus:border-amber-400"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleSaveItemLocation(editingItemLocation, false)}
                    className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span>⚠️</span>
                    <span>Guardar Cambio de Lugar (Marcar Amarillo en Excel)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveItemLocation(editingItemLocation, true)}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span>✓</span>
                    <span>Confirmar que está Todo Bien (Marcar Verde en Excel)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingItemLocation(null)}
                    className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* LISTADO DE PARTIDAS SEGÚN EL FILTRO SELECCIONADO */}
          {activeBatch && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-slate-300 uppercase">
                  Partidas ({filteredBatchItems.length} de {batchStats.total}):
                </span>
                
                {/* Buscador dentro del lote */}
                <input
                  type="text"
                  placeholder="Filtrar por clave o descripción..."
                  value={batchSearchQuery}
                  onChange={(e) => setBatchSearchQuery(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1 text-[11px] text-white outline-none w-48 font-medium"
                />
              </div>

              {filteredBatchItems.length === 0 ? (
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 text-center">
                  <p className="text-xs text-slate-400 font-bold">No hay partidas que coincidan con este filtro.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-1">
                  {filteredBatchItems.map((item) => {
                    const exp = item.expectedQty || 0;
                    const rcv = item.scannedQty || 0;
                    const pending = Math.max(0, exp - rcv);
                    const isComplete = rcv >= exp && exp > 0;
                    const isSurplus = rcv > exp;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border transition flex flex-col gap-2 ${
                          isSurplus ? 'bg-purple-950/40 border-purple-800/80' :
                          isComplete ? 'bg-emerald-950/30 border-emerald-800/80' :
                          rcv > 0 ? 'bg-amber-950/20 border-amber-800/60' :
                          'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-black text-xs text-white bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                                {item.code}
                              </span>
                              {item.barcode && (
                                <span className="font-mono text-[10px] text-slate-400">
                                  {item.barcode}
                                </span>
                              )}
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                isSurplus ? 'bg-purple-900 text-purple-200' :
                                isComplete ? 'bg-emerald-900 text-emerald-200' :
                                rcv > 0 ? 'bg-amber-900 text-amber-200' :
                                'bg-slate-800 text-slate-400'
                              }`}>
                                {isSurplus ? `+${rcv - exp} EXCEDENTE` : isComplete ? '✓ COMPLETO' : `FALTAN ${pending}`}
                              </span>

                              {/* Marca de auditoría de ubicación */}
                              {item.locationStatus === 'RELOCATED' && (
                                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-bold">
                                  ⚠️ REUBICADA
                                </span>
                              )}
                              {item.locationStatus === 'VERIFIED_OK' && (
                                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-bold">
                                  ✓ VERIFICADA
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-300 font-medium mt-1 truncate max-w-md">
                              {item.description}
                            </p>

                            <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span>📍 Ubicación:</span>
                              <strong className="text-emerald-400">{item.location || 'Sin Asignar'}</strong>
                            </p>
                          </div>

                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <div className="text-right">
                              <span className="font-mono font-black text-sm text-white">
                                {rcv} / {exp}
                              </span>
                              <span className="text-[10px] text-slate-400 block">piezas</span>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setCapturingItem(item);
                                  setScannedBarcodeForLinking(item.barcode || item.code);
                                  setBarcodeToLinkInput(item.barcode || '');
                                  const rem = Math.max(0, exp - rcv);
                                  const defPieces = (rem > 0 && rem <= 5) ? rem : 10;
                                  const defBoxes = (rem > 0 && defPieces > 0) ? Math.max(1, Math.floor(rem / defPieces)) : 1;
                                  setPiecesPerBox(defPieces);
                                  setBoxCount(defBoxes);
                                  setDirectTotalQty(defPieces * defBoxes);
                                }}
                                className="bg-purple-600 hover:bg-purple-500 text-white font-black text-[11px] px-2.5 py-1 rounded-xl transition cursor-pointer"
                              >
                                + Recibir
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemLocation(item);
                                  setLocationEditInput(item.location || '');
                                }}
                                className="bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[11px] px-2 py-1 rounded-xl transition border border-slate-700"
                                title="Cambiar o verificar posición"
                              >
                                📍
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Barra de progreso de la partida */}
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              isSurplus ? 'bg-purple-400' : isComplete ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                            style={{ width: `${Math.min(100, exp > 0 ? (rcv / exp) * 100 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: MODO CATÁLOGO GENERAL Y AUDITORÍA DE UBICACIONES */}
      {/* ========================================================================= */}
      {activeMode === 'CATALOG' && (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900/90 p-4 rounded-3xl border border-slate-800 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs font-black text-slate-200 uppercase tracking-wide flex items-center gap-2">
                <span>Consulta de Catálogo y Ubicación Física:</span>
                <span className="text-[10px] text-blue-400 font-bold bg-blue-950/60 border border-blue-800/50 px-2 py-0.5 rounded-md">Catálogo Maestro</span>
              </label>

              <button
                type="button"
                onClick={() => ConsumiblesController.exportExcel(catalog)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                title="Descargar Excel oficial de consumibles con marcas de reubicación y pestaña de movimientos"
              >
                <span>📥</span>
                <span>Exportar Excel (Ubicaciones y Movimientos)</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="ESCANEA O ESCRIBE LA CLAVE O MODELO..."
                value={catalogScanInput}
                onChange={(e) => setCatalogScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleProcessCatalogScan(catalogScanInput);
                  }
                }}
                className="flex-1 bg-slate-950 border-2 border-blue-500 rounded-2xl px-4 py-3 text-sm font-mono font-black text-white uppercase outline-none"
              />
              <button
                type="button"
                onClick={() => handleProcessCatalogScan(catalogScanInput)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-black px-5 rounded-2xl text-xs transition"
              >
                Buscar
              </button>
            </div>
          </div>

          {/* TARJETA DE PRODUCTO ACTIVO EN MODO CATÁLOGO */}
          {activeCatalogItem && (
            <div className="bg-slate-900 border-2 border-blue-500 rounded-3xl p-5 shadow-2xl flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <span className="bg-blue-600 font-mono font-black text-xs px-2.5 py-0.5 rounded-lg text-white">
                    {activeCatalogItem.clave}
                  </span>
                  <h3 className="text-base font-black text-white mt-1">
                    {activeCatalogItem.modelo || activeCatalogItem.descripcion}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCatalogItem(null)}
                  className="text-slate-400 hover:text-white font-bold text-lg"
                >
                  ✕
                </button>
              </div>

              {/* Ubicación actual */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-black text-slate-400 uppercase">Ubicación Física Actual:</span>
                <p className="text-lg font-black text-emerald-400 mt-1 flex items-center gap-2">
                  <span>📍</span>
                  <span>{activeCatalogItem.seccion || 'Sin Sección'} [Anaquel: {activeCatalogItem.anaquel || 'S/N'} - Espacio: {activeCatalogItem.espacio || 'S/N'}]</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">Almacén: <strong className="text-slate-200">{activeCatalogItem.almacen || 'Principal'}</strong></p>
              </div>

              {/* Botones de acción */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleConfirmLocationOkCatalog(activeCatalogItem)}
                  className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl text-xs transition flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <span>✓</span>
                  <span>Todo en Orden (Verde)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsEditingCatalogLocation(true)}
                  className="py-3 px-4 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-2xl text-xs transition flex items-center justify-center gap-2 shadow-md cursor-pointer"
                >
                  <span>✏️</span>
                  <span>Cambiar Ubicación (Amarillo)</span>
                </button>
              </div>

              {/* Formulario de edición de ubicación si se activó */}
              {isEditingCatalogLocation && (
                <div className="bg-slate-950 p-4 rounded-2xl border border-amber-500/60 flex flex-col gap-3 animate-in fade-in">
                  <h4 className="text-xs font-black text-amber-300 uppercase">Reubicar Producto en Almacén:</h4>
                  
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">Sección/Fila:</label>
                      <input
                        type="text"
                        value={editSeccion}
                        onChange={(e) => setEditSeccion(e.target.value.toUpperCase())}
                        placeholder="Ej. B03..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white uppercase outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">Anaquel/Nivel:</label>
                      <input
                        type="text"
                        value={editAnaquel}
                        onChange={(e) => setEditAnaquel(e.target.value.toUpperCase())}
                        placeholder="Ej. 02..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white uppercase outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">Espacio/Caja:</label>
                      <input
                        type="text"
                        value={editEspacio}
                        onChange={(e) => setEditEspacio(e.target.value.toUpperCase())}
                        placeholder="Ej. 1..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white uppercase outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingCatalogLocation(false)}
                      className="flex-1 py-2 bg-slate-800 text-slate-300 font-bold rounded-xl text-xs"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveModifiedLocationCatalog}
                      className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-xl text-xs transition"
                    >
                      Guardar Reubicación
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODAL PARA VINCULAR CÓDIGO NUEVO A UN CONSUMIBLE */}
          {unlinkedCode && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-amber-500 w-full max-w-md rounded-3xl p-5 shadow-2xl flex flex-col gap-3 text-white">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-black text-amber-300">Vincular Código Nuevo al Catálogo</h3>
                  <button type="button" onClick={() => setUnlinkedCode(null)} className="text-slate-400 hover:text-white">✕</button>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
                  <span className="text-slate-400 text-[10px] uppercase font-bold">Código Escaneado:</span>
                  <p className="font-mono font-black text-amber-400 text-sm">{unlinkedCode}</p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-slate-300">
                    Busca la Clave o Producto al que pertenece:
                  </label>
                  <input
                    type="text"
                    value={linkingSearch}
                    onChange={(e) => setLinkingSearch(e.target.value)}
                    placeholder="Escribe la clave (ej. TN-450, HP 85A)..."
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {ConsumiblesController.searchPredictive(linkingSearch, catalog, 6).map(it => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={async () => {
                        await ConsumiblesRepository.linkBarcodeToConsumible(unlinkedCode, it.clave);
                        soundEffects.playScanSuccess();
                        showToast('success', `✓ Código vinculado a ${it.clave}`);
                        setUnlinkedCode(null);
                        loadCatalogData();
                      }}
                      className="bg-slate-800/80 hover:bg-slate-700 p-2.5 rounded-xl border border-slate-700 text-left flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <span className="font-mono font-bold text-amber-300 text-xs">{it.clave}</span>
                        <p className="text-[11px] text-slate-300 truncate max-w-[200px]">{it.modelo || it.descripcion}</p>
                      </div>
                      <span className="text-emerald-400 text-xs font-bold">+ Vincular</span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setUnlinkedCode(null)}
                  className="w-full py-2 bg-slate-800 text-slate-400 hover:text-white font-bold rounded-xl text-xs mt-2"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
