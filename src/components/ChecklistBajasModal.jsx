import { useState, useRef, useEffect, useMemo } from 'react';
import { soundEffects } from '../utils/soundEffects.js';
import { findSerialMatch, extractSerialFromScanned } from '../utils/serialMatcher.js';
import { InventoryController } from '../controllers/InventoryController.js';
import { getRequesters, addRequester, removeRequester } from '../utils/requestersManager.js';

export default function ChecklistBajasModal({
  isOpen,
  onClose,
  batchDetails,
  onMarkBaja,
  onCancelBaja,
  onOpenModoBajas
}) {
  const [activeTab, setActiveTab] = useState('bajas'); // 'bajas' | 'catalogo'
  const [scanInput, setScanInput] = useState('');
  const [bajaDateInput, setBajaDateInput] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [bajaReason, setBajaReason] = useState('Salida de almacén');
  const [requestersList, setRequestersList] = useState(() => getRequesters());
  const [selectedRequester, setSelectedRequester] = useState(() => {
    const list = getRequesters();
    return list[0] || 'DANIA';
  });
  const [showAddRequester, setShowAddRequester] = useState(false);
  const [newRequesterName, setNewRequesterName] = useState('');
  const [bajasSearchQuery, setBajasSearchQuery] = useState('');
  const [searchCatalogQuery, setSearchCatalogQuery] = useState('');
  const [notification, setNotification] = useState(null); // { type: 'success' | 'error' | 'warning', text: string }

  const scanInputRef = useRef(null);

  // Auto-focus en el input de escaneo al abrir el modal o cambiar de pestaña
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (scanInputRef.current) scanInputRef.current.focus();
      }, 150);
    }
  }, [isOpen, activeTab]);

  const expected = batchDetails?.expectedSeries || [];

  // Lista de impresoras actualmente marcadas como BAJA
  const bajasList = useMemo(() => {
    return expected.filter(p => p.isBaja || p.status === 'BAJA');
  }, [expected]);

  // Lista filtrada de bajas para la tablita estilo Excel
  const filteredBajas = useMemo(() => {
    const q = bajasSearchQuery.trim().toLowerCase();
    if (!q) return bajasList;
    return bajasList.filter(p => 
      (p.serial || '').toLowerCase().includes(q) ||
      (p.material || '').toLowerCase().includes(q) ||
      String(p.internalNumber || '').includes(q) ||
      (p.requestedBy || p.requested_by || '').toLowerCase().includes(q) ||
      (p.bajaReason || '').toLowerCase().includes(q) ||
      (p.warehouseRow || '').toLowerCase().includes(q) ||
      (p.warehouseSpace || '').toLowerCase().includes(q)
    );
  }, [bajasList, bajasSearchQuery]);

  // Lista filtrada del catálogo de este checklist
  const filteredCatalog = useMemo(() => {
    const q = searchCatalogQuery.trim().toLowerCase();
    if (!q) return expected;
    return expected.filter(p => 
      (p.serial || '').toLowerCase().includes(q) ||
      (p.material || '').toLowerCase().includes(q) ||
      (p.documentName || '').toLowerCase().includes(q)
    );
  }, [expected, searchCatalogQuery]);

  const showNotification = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Procesar escaneo o confirmación de baja con hora exacta al segundo
  const handleProcessBaja = async (scannedCode) => {
    if (!scannedCode || !scannedCode.trim()) return;
    const code = scannedCode.trim().toUpperCase();

    const matchedItem = findSerialMatch(code, expected);
    if (!matchedItem) {
      soundEffects.playScanError();
      const notFoundSerial = extractSerialFromScanned(code) || code;
      showNotification('error', `La serie "${notFoundSerial}" no pertenece a este checklist (${batchDetails.folio}).`);
      setScanInput('');
      return;
    }

    if (matchedItem.isBaja || matchedItem.status === 'BAJA') {
      soundEffects.playScanDuplicate();
      showNotification('warning', `La serie "${matchedItem.serial}" ya está dada de baja.`);
      setScanInput('');
      return;
    }

    // Registrar baja con la hora exacta al segundo en que se detectó
    const dateToUse = new Date().toISOString();
    soundEffects.playScanSuccess();
    
    if (onMarkBaja) {
      await onMarkBaja(matchedItem.serial, dateToUse, bajaReason, batchDetails.id, selectedRequester);
    }

    showNotification('success', `✓ Serie ${matchedItem.serial} dada de baja exitosamente.`);
    setScanInput('');
    if (scanInputRef.current) scanInputRef.current.focus();
  };

  // Cancelar / Revertir una baja
  const handleRevertBaja = async (serial) => {
    const confirmCancel = window.confirm(`¿Confirmas que deseas CANCELAR la baja de la serie ${serial} y restaurarla a disponible?`);
    if (!confirmCancel) return;

    soundEffects.playScanSuccess();
    if (onCancelBaja) {
      await onCancelBaja(serial, batchDetails.id);
    }

    showNotification('success', `✓ Baja cancelada. Serie ${serial} restaurada a Disponible.`);
  };

  if (!isOpen || !batchDetails) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden text-slate-800">
        
        {/* CABECERA DEL MODAL */}
        <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 text-white p-4 sm:p-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0 shadow-inner">
              📦
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-rose-500/30 text-rose-200 border border-rose-400/30 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Módulo de Salidas
                </span>
                <span className="text-xs font-mono font-bold text-rose-300">
                  {batchDetails.folio}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-black text-white mt-0.5 tracking-tight">
                Gestión de Bajas del Checklist
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenModoBajas && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenModoBajas();
                }}
                className="hidden sm:flex text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/20 text-white px-3 py-1.5 rounded-xl transition items-center gap-1.5 cursor-pointer"
                title="Abrir sesión en Modo Bajas a pantalla completa"
              >
                <span>🔴</span>
                <span>Ir a Modo Bajas</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition text-lg leading-none cursor-pointer"
              title="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        {/* NOTIFICACIÓN FLOTANTE TEMPORAL */}
        {notification && (
          <div className={`py-2 px-4 text-xs font-bold text-center flex items-center justify-center gap-2 animate-fade-in ${
            notification.type === 'success' 
              ? 'bg-emerald-600 text-white' 
              : notification.type === 'warning' 
                ? 'bg-amber-500 text-slate-900' 
                : 'bg-rose-600 text-white'
          }`}>
            <span>{notification.text}</span>
          </div>
        )}

        {/* ZONA DE ESCANEO RÁPIDO */}
        <div className="p-4 bg-rose-50/70 border-b border-rose-100 flex flex-col gap-2.5">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessBaja(scanInput);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-rose-400 font-bold">
                🔫
              </span>
              <input
                ref={scanInputRef}
                type="text"
                autoComplete="off"
                placeholder="Escanea el código de barras o escribe el número de serie..."
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                className="w-full bg-white border-2 border-rose-300 focus:border-rose-600 focus:ring-2 focus:ring-rose-200 rounded-xl pl-10 pr-3 py-2 text-xs font-mono font-bold text-slate-900 uppercase outline-none shadow-xs transition"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Selector de Nombre que solicita */}
              <div className="flex items-center gap-1 bg-white border border-rose-200 rounded-xl px-2 py-1">
                <span className="text-[11px] font-bold text-rose-800 shrink-0">👤 Solicita:</span>
                <select
                  value={selectedRequester}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      setShowAddRequester(true);
                    } else {
                      setSelectedRequester(e.target.value);
                    }
                  }}
                  className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                >
                  {requestersList.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value="__NEW__">+ Agregar otro nombre...</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddRequester(true)}
                  className="text-xs text-rose-700 hover:text-rose-900 font-black px-1"
                  title="Agregar nuevo solicitante a la lista"
                >
                  ➕
                </button>
              </div>

              <input
                type="text"
                placeholder="Motivo (ej. Venta, Taller, Garantía)..."
                value={bajaReason}
                onChange={(e) => setBajaReason(e.target.value)}
                className="bg-white border border-rose-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 outline-none w-44 shrink-0"
              />

              <button
                type="submit"
                className="bg-rose-700 hover:bg-rose-800 active:scale-95 text-white font-black text-xs px-4 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <span>📦</span>
                <span>Dar de Baja</span>
              </button>
            </div>
          </form>

          {/* Modal rápido para agregar nuevo solicitante */}
          {showAddRequester && (
            <div className="mt-2 p-3 bg-white rounded-xl border border-rose-300 shadow-sm flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Nuevo Solicitante:</span>
              <input
                type="text"
                placeholder="Escribe el nombre (ej. ROBERTO)..."
                value={newRequesterName}
                onChange={(e) => setNewRequesterName(e.target.value.toUpperCase())}
                className="flex-1 py-1 px-2 border border-slate-300 rounded-lg text-xs font-bold uppercase outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  if (newRequesterName.trim()) {
                    const updated = addRequester(newRequesterName);
                    setRequestersList(updated);
                    setSelectedRequester(newRequesterName.trim().toUpperCase());
                    setNewRequesterName('');
                    setShowAddRequester(false);
                  }
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1 rounded-lg"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setShowAddRequester(false)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs px-2.5 py-1 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>

        {/* PESTAÑAS DE NAVEGACIÓN DENTRO DEL MODAL */}
        <div className="flex items-center justify-between px-4 sm:px-5 pt-3 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('bajas')}
              className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'bajas'
                  ? 'border-rose-600 text-rose-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>📊 Tabla de Bajas en Pantalla</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                activeTab === 'bajas' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {bajasList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('catalogo')}
              className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'catalogo'
                  ? 'border-rose-600 text-rose-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>📋 Catálogo del Lote</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                activeTab === 'catalogo' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {expected.length}
              </span>
            </button>
          </div>

          <div className="text-[11px] font-semibold text-slate-500 hidden sm:block">
            {bajasList.length} de {expected.length} dados de baja ({Math.round((bajasList.length / (expected.length || 1)) * 100)}%)
          </div>
        </div>

        {/* CUERPO DEL CONTENIDO SEGÚN LA PESTAÑA */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 bg-white">
          {activeTab === 'bajas' ? (
            bajasList.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-xl mb-2">
                  📦
                </div>
                <p className="text-sm font-bold text-slate-700">No hay equipos dados de baja en este checklist</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Escanea la pistola lectora o escribe el número de serie arriba para marcar la salida del equipo.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Buscador dentro de las bajas */}
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1 max-w-md">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                      🔍
                    </span>
                    <input
                      type="text"
                      value={bajasSearchQuery}
                      onChange={(e) => setBajasSearchQuery(e.target.value)}
                      placeholder="Filtrar por serie, modelo, Santi..."
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 focus:border-rose-500 rounded-xl text-xs font-medium text-slate-800 outline-none"
                    />
                  </div>
                  <span className="text-xs text-slate-500">
                    Mostrando <strong>{filteredBajas.length}</strong> de {bajasList.length}
                  </span>
                </div>

                {/* TABLITA ESTILO EXCEL */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-2xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wider sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-2.5 w-10 text-center">#</th>
                        <th className="py-2 px-2.5 min-w-[130px]">Hora Exacta</th>
                        <th className="py-2 px-2.5 min-w-[100px]">Fecha</th>
                        <th className="py-2 px-2.5 min-w-[140px]">Número de Serie</th>
                        <th className="py-2 px-2.5 min-w-[160px]">Modelo</th>
                        <th className="py-2 px-2.5 min-w-[80px]"># Santi</th>
                        <th className="py-2 px-2.5 min-w-[140px]">Nombre que solicita</th>
                        <th className="py-2 px-2.5 min-w-[140px]">Motivo</th>
                        <th className="py-2 px-2.5 w-24 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {filteredBajas.map((item, idx) => {
                        const rawTime = item.scannedAt || item.bajaAt || item.assignedAt;
                        let formattedDate = '-';
                        let formattedTime = '-';
                        if (rawTime) {
                          const d = new Date(rawTime);
                          if (!isNaN(d.getTime())) {
                            formattedDate = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                            formattedTime = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                          }
                        }

                        const whRow = item.warehouseRow && item.warehouseRow !== 'Sin Asignar' 
                          ? `${item.warehouseRow} ${item.warehouseSpace ? `[${item.warehouseSpace}]` : ''}`
                          : 'Sin Asignar';

                        return (
                          <tr key={item.serial || idx} className="hover:bg-rose-50/40 transition">
                            <td className="py-2 px-2.5 text-center text-slate-400 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-2.5 font-mono font-bold text-rose-900">
                              <span className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-[11px]">
                                <span>🕒</span>
                                <span>{formattedTime}</span>
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-slate-600 font-mono text-[11px]">
                              {formattedDate}
                            </td>
                            <td className="py-2 px-2.5 font-mono font-bold text-slate-900 select-all">
                              {item.serial}
                            </td>
                            <td className="py-2 px-2.5 text-slate-700 font-semibold truncate max-w-[200px]" title={item.material}>
                              {item.material}
                            </td>
                            <td className="py-2 px-2.5">
                              {item.internalNumber ? (
                                <span className="bg-slate-800 text-white font-bold text-[10px] px-1.5 py-0.5 rounded">
                                  #{item.internalNumber}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5">
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-bold">
                                <span>👤</span>
                                <span>{item.requestedBy || item.requested_by || 'Sin especificar'}</span>
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-slate-600 italic text-[11px] truncate max-w-[160px]" title={item.bajaReason || 'Salida'}>
                              {item.bajaReason || 'Salida'}
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleRevertBaja(item.serial)}
                                className="text-[10px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-2 py-1 rounded-md font-bold transition cursor-pointer"
                                title="Cancelar baja y regresar la serie a disponible"
                              >
                                ↩ Cancelar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : (
            /* PESTAÑA CATÁLOGO: BUSCAR Y DAR DE BAJA */
            <div className="flex flex-col gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchCatalogQuery}
                  onChange={(e) => setSearchCatalogQuery(e.target.value)}
                  placeholder="Buscar serie, modelo o documento para dar de baja..."
                  className="w-full bg-slate-50 border border-slate-300 focus:border-rose-500 rounded-xl px-3.5 py-2 text-xs text-slate-800 outline-none"
                />
                {searchCatalogQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchCatalogQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                {filteredCatalog.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No se encontraron series con ese criterio.</p>
                ) : (
                  filteredCatalog.map((item, idx) => {
                    const isBaja = item.isBaja || item.status === 'BAJA';
                    return (
                      <div
                        key={item.serial || idx}
                        className={`p-2.5 rounded-xl border flex justify-between items-center text-xs transition ${
                          isBaja ? 'bg-rose-50/70 border-rose-200' : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-800">{item.serial}</span>
                            {item.internalNumber && (
                              <span className="text-[10px] text-slate-500 font-bold">#{item.internalNumber}</span>
                            )}
                            {isBaja && (
                              <span className="text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.2 rounded">
                                BAJA
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 block">{item.material}</span>
                        </div>

                        {isBaja ? (
                          <button
                            type="button"
                            onClick={() => handleRevertBaja(item.serial)}
                            className="text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer"
                          >
                            ↩ Cancelar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleProcessBaja(item.serial)}
                            className="text-xs text-rose-700 hover:text-white bg-rose-50 hover:bg-rose-700 border border-rose-200 px-3 py-1 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer"
                          >
                            <span>📦</span>
                            <span>Dar de Baja</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* PIE DEL MODAL CON ACCIONES */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => InventoryController.exportChecklistReportToExcel(batchDetails)}
              className="w-full sm:w-auto text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-4 py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              title="Descargar Excel actualizado con la hoja de Bajas y sus fechas"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Descargar Excel con Bajas</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-xl text-xs transition cursor-pointer shadow-xs"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
}
