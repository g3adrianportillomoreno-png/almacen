import { useState, useMemo, useRef, useEffect } from 'react';
import { findSerialMatch } from '../utils/serialMatcher.js';
import { soundEffects } from '../utils/soundEffects.js';
import { InventoryController } from '../controllers/InventoryController.js';

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

  // Procesar escaneo o confirmación de baja
  const handleProcessBaja = async (scannedCode) => {
    if (!scannedCode || !scannedCode.trim()) return;
    const code = scannedCode.trim().toUpperCase();

    const matchedItem = findSerialMatch(code, expected);
    if (!matchedItem) {
      soundEffects.playScanError();
      showNotification('error', `La serie "${code}" no pertenece a este checklist (${batchDetails.folio}).`);
      setScanInput('');
      return;
    }

    if (matchedItem.isBaja || matchedItem.status === 'BAJA') {
      soundEffects.playScanDuplicate();
      showNotification('warning', `La serie "${matchedItem.serial}" ya está dada de baja.`);
      setScanInput('');
      return;
    }

    // Registrar baja
    const dateToUse = bajaDateInput ? new Date(bajaDateInput).toISOString() : new Date().toISOString();
    soundEffects.playScanSuccess();
    
    if (onMarkBaja) {
      await onMarkBaja(matchedItem.serial, dateToUse, bajaReason, batchDetails.id);
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
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800">
        
        {/* CABECERA DEL MODAL */}
        <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 text-white p-5 sm:p-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0 shadow-inner">
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
              <h2 className="text-lg sm:text-xl font-black text-white mt-0.5 tracking-tight">
                Gestión de Bajas del Checklist
              </h2>
              <p className="text-xs text-rose-200/80 mt-0.5 truncate max-w-md">
                {batchDetails.cleanName || batchDetails.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenModoBajas && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenModoBajas();
                }}
                className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 border border-rose-400 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                title="Abrir en Modo Bajas a pantalla completa para escanear y cerrar sesión"
              >
                <span>🔴</span>
                <span className="hidden sm:inline">Modo Bajas Completo</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl p-2 transition text-sm cursor-pointer shrink-0"
              title="Cerrar modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* NOTIFICACIÓN / ALERTA TEMPORAL */}
        {notification && (
          <div className={`px-4 py-2.5 text-xs font-bold flex items-center justify-between transition animate-fade-in ${
            notification.type === 'success' ? 'bg-emerald-600 text-white' :
            notification.type === 'error' ? 'bg-rose-600 text-white' :
            'bg-amber-500 text-slate-950 font-black'
          }`}>
            <span>{notification.text}</span>
            <button type="button" onClick={() => setNotification(null)} className="text-xs opacity-75 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ÁREA DE DISPARO RÁPIDO PARA DAR DE BAJA */}
        <div className="p-4 sm:p-5 bg-rose-50/50 border-b border-rose-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessBaja(scanInput);
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  ref={scanInputRef}
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="ESCANEAR O ESCRIBIR SERIE PARA DAR DE BAJA..."
                  className="w-full bg-white border-2 border-rose-300 focus:border-rose-600 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold uppercase text-slate-900 outline-none placeholder-slate-400 shadow-2xs"
                />
              </div>

              <button
                type="submit"
                className="bg-rose-700 hover:bg-rose-800 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0 active:scale-95"
              >
                <span>📦</span>
                <span>Dar de Baja</span>
              </button>
            </div>

            {/* Ajustes de Fecha y Motivo */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 bg-white border border-rose-200 px-2.5 py-1.5 rounded-lg text-slate-700">
                <span className="text-[11px] font-bold text-slate-500 uppercase">Fecha Salida:</span>
                <input
                  type="datetime-local"
                  value={bajaDateInput}
                  onChange={(e) => setBajaDateInput(e.target.value)}
                  className="text-xs font-semibold text-slate-800 bg-transparent outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-white border border-rose-200 px-2.5 py-1.5 rounded-lg text-slate-700 flex-1 min-w-[200px]">
                <span className="text-[11px] font-bold text-slate-500 uppercase shrink-0">Motivo:</span>
                <input
                  type="text"
                  value={bajaReason}
                  onChange={(e) => setBajaReason(e.target.value)}
                  placeholder="Ej. Salida de almacén, garantía..."
                  className="text-xs text-slate-800 bg-transparent outline-none w-full"
                />
              </div>
            </div>
          </form>
        </div>

        {/* PESTAÑAS DE NAVEGACIÓN DENTRO DEL MODAL */}
        <div className="flex items-center justify-between px-5 pt-3 border-b border-slate-200 bg-slate-50/60">
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
              <span>Equipos Dados de Baja</span>
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
              <span>Seleccionar de la Lista</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                activeTab === 'catalogo' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {expected.length}
              </span>
            </button>
          </div>

          <div className="text-[11px] font-semibold text-slate-500 hidden sm:block">
            {bajasList.length} de {expected.length} dados de baja
          </div>
        </div>

        {/* CUERPO DEL CONTENIDO SEGÚN LA PESTAÑA */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {activeTab === 'bajas' ? (
            bajasList.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-xl mb-2">
                  📦
                </div>
                <p className="text-sm font-bold text-slate-700">No hay equipos dados de baja en este checklist</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Escanea la pistola lectora o escribe el número de serie arriba para marcar la salida del equipo con su fecha.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {bajasList.map((item, idx) => (
                  <div
                    key={item.serial || idx}
                    className="p-3 bg-white rounded-xl border border-rose-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 hover:border-rose-300 transition shadow-2xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-rose-800 text-sm">
                          {item.serial}
                        </span>
                        {item.internalNumber && (
                          <span className="bg-slate-800 text-white font-bold text-[10px] px-1.5 py-0.2 rounded">
                            #{item.internalNumber}
                          </span>
                        )}
                        <span className="bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          DADA DE BAJA
                        </span>
                        {item.documentName && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium truncate max-w-[150px]">
                            📄 {item.documentName}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                        <span>Modelo: <strong className="text-slate-700">{item.material}</strong></span>
                        {item.bajaAt && (
                          <span className="text-rose-700 font-medium">
                            Fecha Salida: <strong>{new Date(item.bajaAt).toLocaleString('es-MX')}</strong>
                          </span>
                        )}
                        {item.bajaReason && (
                          <span className="text-slate-500 italic">
                            ({item.bajaReason})
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevertBaja(item.serial)}
                      className="text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer shrink-0"
                      title="Cancelar baja y regresar la serie a disponible"
                    >
                      <span>↩</span>
                      <span>Cancelar Baja</span>
                    </button>
                  </div>
                ))}
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
                            className="text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 px-2.5 py-1 rounded-lg font-semibold transition"
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
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => InventoryController.exportChecklistReportToExcel(batchDetails)}
              className="w-full sm:w-auto text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-4 py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-2xs"
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

