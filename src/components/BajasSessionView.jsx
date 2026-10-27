import { useState, useMemo, useRef, useEffect } from 'react';
import { InventoryController } from '../controllers/InventoryController.js';
import { findSerialMatch } from '../utils/serialMatcher.js';
import { soundEffects } from '../utils/soundEffects.js';
import CameraScanner from './CameraScanner.jsx';

export default function BajasSessionView({
  batches = [],
  allPrinters = [],
  allSystemPrinters = [],
  onBajasCommitted,
  onBack,
  preselectedBatchId = null
}) {
  // Pestañas principales: 'session' (modo escaneo de bajas) | 'history' (reportes por fecha)
  const [mainTab, setMainTab] = useState('session');

  // Estado de la sesión activa de Bajas
  const [activeSession, setActiveSession] = useState(null); // { targetScope, targetBatchId, targetLoteName, bajaDate, reason, operator, items: [] }

  // Formulario de configuración de nueva sesión
  const [targetScope, setTargetScope] = useState(() => (preselectedBatchId ? 'LOTE' : 'ALL')); // 'ALL' | 'LOTE'
  const [selectedBatchId, setSelectedBatchId] = useState(() => preselectedBatchId ? String(preselectedBatchId) : '');
  const [bajaDateInput, setBajaDateInput] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [reasonPreset, setReasonPreset] = useState('Salida de almacén');
  const [customReason, setCustomReason] = useState('');
  const [operatorName, setOperatorName] = useState('');

  // Estados durante el escaneo activo
  const [scanInput, setScanInput] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success' | 'error' | 'warning', text: string }

  // Modal de confirmación para Cerrar Bajas
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastClosedReport, setLastClosedReport] = useState(null);

  // Estados del Historial de Reportes por Fecha
  const [historyFilterPreset, setHistoryFilterPreset] = useState('7DAYS'); // 'TODAY' | '7DAYS' | 'MONTH' | 'ALL' | 'CUSTOM'
  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [historyEndDate, setHistoryEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyLoteFilter, setHistoryLoteFilter] = useState('ALL');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [departuresHistory, setDeparturesHistory] = useState([]);
  const [bajasSessionsHistory, setBajasSessionsHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const scanInputRef = useRef(null);

  // Auto-focus continuo en el input de escaneo durante la sesión activa
  useEffect(() => {
    if (activeSession && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [activeSession]);

  // Si se envió un preselectedBatchId, seleccionarlo
  useEffect(() => {
    if (preselectedBatchId) {
      setTargetScope('LOTE');
      setSelectedBatchId(String(preselectedBatchId));
    }
  }, [preselectedBatchId]);

  // Cargar historial de bajas
  const loadHistoryData = async () => {
    setIsLoadingHistory(true);
    try {
      const deps = await InventoryController.getDeparturesHistory();
      setDeparturesHistory(deps || []);
      const sess = InventoryController.getBajasSessions();
      setBajasSessionsHistory(sess || []);
    } catch (e) {
      console.warn("Error cargando historial de bajas:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (mainTab === 'history') {
      loadHistoryData();
    }
  }, [mainTab]);

  const receptionBatches = useMemo(() => {
    return (batches || []).filter(b => !b.isMaster);
  }, [batches]);

  const showNotificationMsg = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Universo de impresoras disponibles según el ámbito seleccionado
  const candidatePool = useMemo(() => {
    if (!activeSession) return [];
    if (activeSession.targetScope === 'LOTE' && activeSession.targetBatchId) {
      const selectedBatch = batches.find(b => String(b.id) === String(activeSession.targetBatchId));
      return selectedBatch?.expectedSeries || [];
    }
    // Si es Todo el Inventario, buscar en todas las impresoras del sistema
    return allSystemPrinters.length > 0 ? allSystemPrinters : allPrinters;
  }, [activeSession, batches, allSystemPrinters, allPrinters]);

  // Iniciar Sesión de Bajas
  const handleStartSession = (e) => {
    e.preventDefault();
    if (targetScope === 'LOTE' && !selectedBatchId) {
      alert("Selecciona el lote o checklist para la sesión de bajas.");
      return;
    }

    let loteName = 'Todo el Inventario';
    if (targetScope === 'LOTE') {
      const found = receptionBatches.find(b => String(b.id) === String(selectedBatchId));
      loteName = found ? `${found.folio} - ${found.cleanName || found.name}` : `Lote #${selectedBatchId}`;
    }

    const finalReason = reasonPreset === 'OTRO' ? (customReason.trim() || 'Salida de almacén') : reasonPreset;

    setActiveSession({
      targetScope,
      targetBatchId: targetScope === 'LOTE' ? selectedBatchId : null,
      targetLoteName: loteName,
      bajaDate: bajaDateInput ? new Date(bajaDateInput).toISOString() : new Date().toISOString(),
      reason: finalReason,
      operator: operatorName.trim() || 'Operador',
      items: []
    });
    setScanInput('');
    setNotification(null);
  };

  // Procesar escaneo de código en Modo Bajas
  const handleProcessScan = (scannedCode) => {
    if (!scannedCode || !scannedCode.trim()) return;
    const code = scannedCode.trim().toUpperCase();

    // 1. Verificar si ya fue escaneado en esta misma sesión activa
    const alreadyInSession = activeSession.items.some(
      it => String(it.serial).trim().toUpperCase() === code
    );
    if (alreadyInSession) {
      soundEffects.playScanDuplicate();
      showNotificationMsg('warning', `⚠️ La serie "${code}" YA está agregada en esta sesión de bajas.`);
      setScanInput('');
      return;
    }

    // 2. Buscar coincidencia en el pool de candidatos
    const matched = findSerialMatch(code, candidatePool);
    if (!matched) {
      soundEffects.playScanError();
      const scopeMsg = activeSession.targetScope === 'LOTE'
        ? `en el lote seleccionado (${activeSession.targetLoteName})`
        : 'en el inventario registrado';
      showNotificationMsg('error', `❌ La serie "${code}" no se encontró ${scopeMsg}.`);
      setScanInput('');
      return;
    }

    // 3. Verificar si ya estaba marcada como BAJA en el sistema previamente
    const wasAlreadyBaja = matched.isBaja || matched.status === 'BAJA';

    // 4. Agregar a la sesión activa
    soundEffects.playScanSuccess();
    const newItem = {
      serial: matched.serial,
      material: matched.material || 'Sin Modelo',
      internalNumber: matched.internalNumber ?? null,
      warehouseName: matched.warehouseName || 'Almacén 1',
      warehouseRow: matched.warehouseRow || 'Sin Asignar',
      warehouseSpace: matched.warehouseSpace || '',
      batchFolio: matched.batchFolio || matched.checklistFolio || '',
      batchName: matched.batchName || matched.checklistName || '',
      checklistId: matched.checklistId || null,
      wasAlreadyBaja,
      scannedAt: new Date().toISOString()
    };

    setActiveSession(prev => ({
      ...prev,
      items: [newItem, ...prev.items]
    }));

    showNotificationMsg(
      'success',
      `✓ Serie ${matched.serial} (${matched.material}) lista para baja.` +
      (newItem.batchFolio ? ` [Lote: ${newItem.batchFolio}]` : '')
    );
    setScanInput('');
    if (scanInputRef.current) scanInputRef.current.focus();
  };

  // Quitar una serie de la sesión de bajas si se escaneó por error
  const handleRemoveItem = (index) => {
    setActiveSession(prev => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index)
    }));
  };

  // Confirmar y Cerrar Bajas
  const handleConfirmCloseBajas = async () => {
    if (!activeSession || activeSession.items.length === 0) {
      alert("No hay equipos escaneados para dar de baja.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await InventoryController.commitBajasSession({
        items: activeSession.items,
        bajaDate: activeSession.bajaDate,
        reason: activeSession.reason,
        operator: activeSession.operator,
        targetScope: activeSession.targetScope,
        targetLoteName: activeSession.targetLoteName
      });

      // Generar y descargar automáticamente el reporte en Excel
      if (result?.session) {
        InventoryController.exportBajasSessionExcel(result.session);
        setLastClosedReport(result.session);
      }

      soundEffects.playScanSuccess();
      alert(
        `✓ ¡Bajas cerradas exitosamente!\n` +
        `• Total de equipos dados de baja: ${activeSession.items.length}\n` +
        `• Motivo: ${activeSession.reason}\n` +
        `• Se ha generado y descargado el Reporte en Excel por fecha.`
      );

      setActiveSession(null);
      setShowCloseModal(false);

      if (onBajasCommitted) {
        await onBajasCommitted();
      }
    } catch (err) {
      alert("Error al registrar las bajas: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtrado del Historial de Bajas por Rango de Fechas
  const filteredDepartures = useMemo(() => {
    const q = historySearchQuery.trim().toLowerCase();
    const startMs = historyStartDate ? new Date(`${historyStartDate}T00:00:00`).getTime() : 0;
    const endMs = historyEndDate ? new Date(`${historyEndDate}T23:59:59`).getTime() : Infinity;

    return departuresHistory.filter(d => {
      const depTime = d.departure_date ? new Date(d.departure_date).getTime() : 0;
      if (depTime < startMs || depTime > endMs) return false;

      if (historyLoteFilter !== 'ALL') {
        const batchTag = d.batchFolio || d.batchName || '';
        if (!batchTag.includes(historyLoteFilter)) return false;
      }

      if (q) {
        const sMatch = (d.serial || '').toLowerCase().includes(q);
        const mMatch = (d.material || '').toLowerCase().includes(q);
        const rMatch = (d.reason || '').toLowerCase().includes(q);
        if (!sMatch && !mMatch && !rMatch) return false;
      }

      return true;
    });
  }, [departuresHistory, historyStartDate, historyEndDate, historyLoteFilter, historySearchQuery]);

  const handleApplyPreset = (preset) => {
    setHistoryFilterPreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    setHistoryEndDate(todayStr);

    if (preset === 'TODAY') {
      setHistoryStartDate(todayStr);
    } else if (preset === '7DAYS') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setHistoryStartDate(d.toISOString().slice(0, 10));
    } else if (preset === 'MONTH') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setHistoryStartDate(d.toISOString().slice(0, 10));
    } else if (preset === 'ALL') {
      setHistoryStartDate('2026-01-01');
    }
  };

  return (
    <div className="flex flex-col flex-1 gap-5 w-full pb-16 animate-fade-in text-slate-800">
      
      {/* BARRA SUPERIOR: ENCABEZADO Y TABS */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-700 to-rose-900 text-white flex items-center justify-center font-bold text-xl shadow-xs shrink-0">
            📦
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Modo Bajas y Salidas de Inventario
              </h2>
              <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
                Control de Bajas
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Escanea equipos para dar salida del almacén, confirmar bajas por lote o generar reportes en Excel por fecha.
            </p>
          </div>
        </div>

        {/* Botones de navegación entre Escaneo e Historial */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 text-xs font-bold w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setMainTab('session')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                mainTab === 'session'
                  ? 'bg-white text-rose-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>⚡</span>
              <span>Modo Bajas (Escaneo)</span>
              {activeSession && (
                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMainTab('history')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                mainTab === 'history'
                  ? 'bg-white text-rose-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📅</span>
              <span>Reportes por Fecha</span>
            </button>
          </div>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl transition"
            >
              &larr; Volver
            </button>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* PESTAÑA 1: MODO BAJAS (SESIÓN DE ESCANEO ACTIVA O NUEVA) */}
      {/* ======================================================== */}
      {mainTab === 'session' && (
        !activeSession ? (
          /* CONFIGURACIÓN PARA INICIAR NUEVA SESIÓN DE BAJAS */
          <div className="max-w-2xl mx-auto w-full bg-white p-6 sm:p-7 rounded-3xl shadow-sm border border-slate-200 flex flex-col gap-5">
            <div className="border-b border-slate-100 pb-3">
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                Paso 1: Configurar Salida
              </span>
              <h3 className="text-lg font-black text-slate-800 mt-0.5">
                Iniciar Nueva Sesión de Bajas
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Define el lote a escanear (o todo el inventario), la fecha oficial de salida y el motivo.
              </p>
            </div>

            <form onSubmit={handleStartSession} className="flex flex-col gap-4">
              {/* 1. SELECCIÓN DE ÁMBITO / LOTE */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  1. Ámbito de Detección / Lotes:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetScope('ALL')}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                      targetScope === 'ALL'
                        ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xl">🌐</span>
                    <div>
                      <span className="text-xs font-bold block">Todo el Inventario</span>
                      <span className="text-[11px] text-slate-500 font-normal">Detecta cualquier serie de almacén</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTargetScope('LOTE');
                      if (!selectedBatchId && receptionBatches[0]) {
                        setSelectedBatchId(String(receptionBatches[0].id));
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-3 cursor-pointer ${
                      targetScope === 'LOTE'
                        ? 'bg-rose-50 border-rose-500 text-rose-900 font-bold shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xl">📋</span>
                    <div>
                      <span className="text-xs font-bold block">Lote / Checklist Específico</span>
                      <span className="text-[11px] text-slate-500 font-normal">Restringe a un lote entrante</span>
                    </div>
                  </button>
                </div>

                {targetScope === 'LOTE' && (
                  <div className="mt-2.5">
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Selecciona el Lote de Salida:
                    </label>
                    <select
                      value={selectedBatchId}
                      onChange={(e) => setSelectedBatchId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                    >
                      {receptionBatches.map(b => (
                        <option key={b.id} value={String(b.id)}>
                          {b.folio} — {b.cleanName || b.name} ({b.expectedSeries?.length || 0} equipos)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 2. FECHA Y HORA DE LA BAJA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    2. Fecha y Hora de Salida:
                  </label>
                  <input
                    type="datetime-local"
                    value={bajaDateInput}
                    onChange={(e) => setBajaDateInput(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Operador / Responsable:
                  </label>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    placeholder="Nombre de quien entrega / autoriza"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none placeholder-slate-400"
                  />
                </div>
              </div>

              {/* 3. MOTIVO DE LA BAJA */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  3. Motivo de la Salida:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-2">
                  {[
                    'Salida de almacén',
                    'Venta / Despacho',
                    'Garantía / Reemplazo',
                    'Equipo dañado / Scrap',
                    'Traslado a sucursal',
                    'OTRO'
                  ].map(motivo => (
                    <button
                      key={motivo}
                      type="button"
                      onClick={() => setReasonPreset(motivo)}
                      className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition cursor-pointer text-center ${
                        reasonPreset === motivo
                          ? 'bg-rose-700 text-white border-rose-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {motivo === 'OTRO' ? 'Otro motivo...' : motivo}
                    </button>
                  ))}
                </div>

                {reasonPreset === 'OTRO' && (
                  <input
                    type="text"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Escribe el motivo detallado de la baja..."
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none"
                  />
                )}
              </div>

              {/* BOTÓN INICIAR SESIÓN */}
              <div className="pt-2 border-t border-slate-100 flex gap-2">
                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-rose-700 to-rose-900 hover:from-rose-800 hover:to-rose-950 text-white font-black py-3 rounded-2xl text-sm transition shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <span>🚀</span>
                  <span>Iniciar Modo Bajas y Comenzar Escaneo</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* ======================================================== */
          /* PANTALLA ACTIVA DE MODO BAJAS (ESCANEO Y CIERRE)        */
          /* ======================================================== */
          <div className="flex flex-col gap-4">
            
            {/* CABECERA DE SESIÓN ACTIVA */}
            <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-slate-900 text-white p-4 sm:p-5 rounded-2xl shadow-sm border border-rose-900/40 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-600/30 border border-rose-500/50 flex items-center justify-center text-2xl shrink-0">
                  🔴
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-rose-500 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                      Sesión de Bajas Activa
                    </span>
                    <span className="text-xs font-mono font-bold text-rose-300">
                      {activeSession.targetLoteName}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-1">
                    <span>Fecha: <strong>{new Date(activeSession.bajaDate).toLocaleString('es-MX')}</strong></span>
                    <span>•</span>
                    <span>Motivo: <strong className="text-rose-200">{activeSession.reason}</strong></span>
                    {activeSession.operator && (
                      <>
                        <span>•</span>
                        <span>Operador: <strong>{activeSession.operator}</strong></span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* CONTADOR GIGANTE Y BOTÓN CERRAR BAJAS */}
              <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                <div className="text-center px-4 py-1.5 rounded-xl bg-white/10 border border-white/20">
                  <span className="text-[10px] text-rose-200 uppercase tracking-wider block font-bold">Escaneadas</span>
                  <span className="text-2xl font-black text-white">{activeSession.items.length}</span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCloseModal(true)}
                  disabled={activeSession.items.length === 0}
                  className="bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 disabled:opacity-50 text-white font-black px-5 py-3 rounded-xl text-xs sm:text-sm transition shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                  title="Cerrar la sesión de bajas, guardar cambios y descargar el reporte Excel"
                >
                  <span>🔴</span>
                  <span>Cerrar Bajas ({activeSession.items.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("¿Deseas cancelar esta sesión de bajas sin guardar?")) {
                      setActiveSession(null);
                    }
                  }}
                  className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1"
                  title="Salir sin guardar"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* NOTIFICACIÓN TEMPORAL DE ESCANEO */}
            {notification && (
              <div className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between transition animate-fade-in shadow-xs ${
                notification.type === 'success' ? 'bg-emerald-600 text-white' :
                notification.type === 'error' ? 'bg-rose-700 text-white' :
                'bg-amber-500 text-slate-950 font-black'
              }`}>
                <span>{notification.text}</span>
                <button type="button" onClick={() => setNotification(null)} className="text-xs opacity-75 hover:opacity-100">✕</button>
              </div>
            )}

            {/* CAJA DE DISPARO DE ESCANEO GIGANTE */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-xs border border-rose-200">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleProcessScan(scanInput);
                }}
                className="flex flex-col sm:flex-row gap-2.5"
              >
                <div className="flex-1 relative">
                  <input
                    type="text"
                    ref={scanInputRef}
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="ESCANEAR CON PISTOLA O ESCRIBIR NÚMERO DE SERIE..."
                    className="w-full bg-slate-50 border-2 border-rose-300 focus:border-rose-600 rounded-2xl px-4 py-3 text-sm sm:text-base font-mono font-black uppercase text-slate-900 outline-none placeholder-slate-400 shadow-inner"
                  />
                </div>

                <button
                  type="submit"
                  className="bg-rose-700 hover:bg-rose-800 text-white font-black px-6 py-3 rounded-2xl text-xs sm:text-sm transition shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0 active:scale-95"
                >
                  <span>📦</span>
                  <span>Dar de Baja</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCameraActive(!isCameraActive)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-3 rounded-2xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  title="Escanear con cámara del celular"
                >
                  <span>📷</span>
                  <span className="hidden sm:inline">Cámara</span>
                </button>
              </form>

              {/* Escáner con cámara */}
              {isCameraActive && (
                <div className="mt-3 p-3 bg-slate-900 rounded-2xl">
                  <CameraScanner
                    onScanSuccess={(code) => {
                      setIsCameraActive(false);
                      handleProcessScan(code);
                    }}
                    onClose={() => setIsCameraActive(false)}
                  />
                </div>
              )}
            </div>

            {/* TABLA EN VIVO DE EQUIPOS ESCANEADOS EN ESTA SESIÓN */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden flex flex-col">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                    Equipos en esta Sesión de Baja ({activeSession.items.length})
                  </h4>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  {activeSession.items.length === 0 ? 'Sin escaneos aún' : 'Haz clic en Cerrar Bajas para confirmar y descargar Excel'}
                </span>
              </div>

              {activeSession.items.length === 0 ? (
                <div className="text-center py-16 px-4 bg-slate-50/50">
                  <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto text-2xl mb-2">
                    📦
                  </div>
                  <p className="text-sm font-bold text-slate-700">Listo para escanear salidas</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Apunta la pistola lectora o escribe el número de serie arriba para agregarlo a la lista de bajas.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-bold text-[11px] uppercase sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Número de Serie</th>
                        <th className="py-2.5 px-3">Modelo</th>
                        <th className="py-2.5 px-3"># Equipo</th>
                        <th className="py-2.5 px-3">Lote Origen</th>
                        <th className="py-2.5 px-3">Ubicación Previa</th>
                        <th className="py-2.5 px-3">Hora</th>
                        <th className="py-2.5 px-3 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {activeSession.items.map((it, idx) => (
                        <tr key={it.serial || idx} className="hover:bg-rose-50/30 transition">
                          <td className="py-2 px-3 text-slate-400 font-bold">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">{it.serial}</td>
                          <td className="py-2 px-3 text-slate-700">{it.material}</td>
                          <td className="py-2 px-3">
                            {it.internalNumber ? (
                              <span className="bg-slate-800 text-white font-bold text-[10px] px-1.5 py-0.2 rounded">
                                #{it.internalNumber}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {it.batchFolio ? (
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-semibold text-[11px]">
                                {it.batchFolio}
                              </span>
                            ) : (it.batchName || 'Inventario')}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {it.warehouseRow && it.warehouseRow !== 'Sin Asignar' ? (
                              <span className="text-blue-700 font-semibold">
                                {it.warehouseRow} {it.warehouseSpace ? `[${it.warehouseSpace}]` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sin Asignar</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                            {it.scannedAt ? new Date(it.scannedAt).toLocaleTimeString('es-MX') : ''}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="text-slate-400 hover:text-rose-600 font-bold px-2 py-0.5 rounded"
                              title="Quitar de esta sesión"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )
      )}

      {/* ======================================================== */}
      {/* PESTAÑA 2: HISTORIAL Y REPORTES DE BAJAS POR FECHA       */}
      {/* ======================================================== */}
      {mainTab === 'history' && (
        <div className="flex flex-col gap-4">
          
          {/* BARRA DE FILTROS POR FECHA Y LOTE */}
          <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">
                  Filtrar Reporte de Bajas por Rango de Fechas
                </h3>
                <p className="text-xs text-slate-500">
                  Selecciona el periodo para ver y descargar el Excel oficial de salidas.
                </p>
              </div>

              {/* Botón Descargar Excel */}
              <button
                type="button"
                onClick={() => InventoryController.exportBajasByDateExcel(
                  filteredDepartures,
                  historyStartDate,
                  historyEndDate,
                  historyLoteFilter
                )}
                disabled={filteredDepartures.length === 0}
                className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-xs flex items-center gap-2 cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Descargar Reporte Excel ({filteredDepartures.length} bajas)</span>
              </button>
            </div>

            {/* Presets Rápidos de Fecha */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase mr-1">Periodo:</span>
              {[
                { id: 'TODAY', label: 'Hoy' },
                { id: '7DAYS', label: 'Últimos 7 días' },
                { id: 'MONTH', label: 'Últimos 30 días' },
                { id: 'ALL', label: 'Todo el Historial' }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPreset(p.id)}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer text-xs ${
                    historyFilterPreset === p.id
                      ? 'bg-rose-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Rango de Fechas Manual y Buscador */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">Desde Fecha:</label>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => {
                    setHistoryStartDate(e.target.value);
                    setHistoryFilterPreset('CUSTOM');
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">Hasta Fecha:</label>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(e) => {
                    setHistoryEndDate(e.target.value);
                    setHistoryFilterPreset('CUSTOM');
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">Filtrar por Lote:</label>
                <select
                  value={historyLoteFilter}
                  onChange={(e) => setHistoryLoteFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                >
                  <option value="ALL">Todos los Lotes</option>
                  {receptionBatches.map(b => (
                    <option key={b.id} value={b.folio}>
                      {b.folio} ({b.cleanName || b.name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">Buscar:</label>
                <input
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="Serie, modelo, motivo..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-800 outline-none placeholder-slate-400"
                />
              </div>
            </div>
          </div>

          {/* TABLA DE RESULTADOS DE BAJAS */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs">
              <span className="font-bold text-slate-700 uppercase">
                Registros encontrados: <strong className="text-rose-800">{filteredDepartures.length}</strong>
              </span>
              <span className="text-slate-500 font-medium text-[11px]">
                {historyStartDate} al {historyEndDate}
              </span>
            </div>

            {filteredDepartures.length === 0 ? (
              <div className="text-center py-14 px-4 bg-slate-50/40">
                <p className="text-xs font-bold text-slate-600">No hay bajas registradas en este periodo.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Prueba ampliando el rango de fechas arriba.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-bold text-[11px] uppercase sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Fecha y Hora</th>
                      <th className="py-2.5 px-3">Número de Serie</th>
                      <th className="py-2.5 px-3">Modelo</th>
                      <th className="py-2.5 px-3"># Equipo</th>
                      <th className="py-2.5 px-3">Lote / Origen</th>
                      <th className="py-2.5 px-3">Última Ubicación</th>
                      <th className="py-2.5 px-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredDepartures.map((d, idx) => (
                      <tr key={d.serial || idx} className="hover:bg-slate-50 transition">
                        <td className="py-2 px-3 text-slate-400 font-bold">{idx + 1}</td>
                        <td className="py-2 px-3 text-slate-600 font-mono text-[11px]">
                          {d.departure_date ? new Date(d.departure_date).toLocaleString('es-MX') : '-'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-rose-800">{d.serial}</td>
                        <td className="py-2 px-3 text-slate-700">{d.material}</td>
                        <td className="py-2 px-3">
                          {d.internal_number ? (
                            <span className="bg-slate-800 text-white font-bold text-[10px] px-1.5 py-0.2 rounded">
                              #{d.internal_number}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{d.batchFolio || d.batchName || 'General'}</td>
                        <td className="py-2 px-3 text-slate-600">
                          {d.warehouse_row && d.warehouse_row !== 'Sin Asignar'
                            ? `${d.warehouse_row} ${d.warehouse_space ? `[${d.warehouse_space}]` : ''}`
                            : 'Sin Asignar'}
                        </td>
                        <td className="py-2 px-3 text-slate-600 italic">{d.reason || 'Baja de almacén'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SESIONES DE BAJAS GUARDADAS RECIENTEMENTE */}
          {bajasSessionsHistory.length > 0 && (
            <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col gap-3">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">
                Sesiones Cerradas de Modo Bajas
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {bajasSessionsHistory.map((sess) => (
                  <div
                    key={sess.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-xs text-rose-800">{sess.folio}</span>
                        <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-2 py-0.5 rounded-full">
                          {sess.itemsCount} equipos
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 font-semibold mt-1 truncate">
                        {sess.targetLoteName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(sess.date).toLocaleString('es-MX')}
                      </p>
                      <p className="text-[11px] text-slate-600 italic mt-0.5 truncate">
                        Motivo: {sess.reason}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => InventoryController.exportBajasSessionExcel(sess)}
                      className="mt-1 w-full bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <span>📥</span>
                      <span>Descargar Excel de esta Sesión</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL DE CONFIRMACIÓN: CERRAR BAJAS Y DESCARGAR REPORTE  */}
      {/* ======================================================== */}
      {showCloseModal && activeSession && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-rose-100 text-rose-700 rounded-2xl flex items-center justify-center text-2xl shrink-0 font-bold">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  Confirmar y Cerrar Bajas
                </h3>
                <p className="text-xs text-slate-500">
                  Se confirmará la salida definitiva de los equipos escaneados.
                </p>
              </div>
            </div>

            {/* Resumen de la sesión */}
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex flex-col gap-2.5 text-xs text-rose-950">
              <div className="flex justify-between items-center pb-2 border-b border-rose-200">
                <span className="font-bold">Total Equipos a Dar de Baja:</span>
                <span className="text-base font-black text-rose-700">{activeSession.items.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Ámbito / Lote:</span>
                <span className="font-bold text-slate-800 truncate max-w-[220px]">{activeSession.targetLoteName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Fecha Oficial:</span>
                <span className="font-bold text-slate-800">{new Date(activeSession.bajaDate).toLocaleString('es-MX')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Motivo:</span>
                <span className="font-bold text-slate-800">{activeSession.reason}</span>
              </div>
              {activeSession.operator && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Operador:</span>
                  <span className="font-bold text-slate-800">{activeSession.operator}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500 italic">
              Al confirmar, el sistema guardará las salidas en la base de datos y <strong>descargará automáticamente el Reporte en Excel</strong> con el folio y fecha correspondiente.
            </p>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmCloseBajas}
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-black text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                <span>{isSubmitting ? 'Cerrando Bajas...' : '✓ Confirmar y Descargar Excel'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
