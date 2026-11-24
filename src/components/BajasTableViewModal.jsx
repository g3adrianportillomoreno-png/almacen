import { useState, useMemo, useEffect } from 'react';
import { InventoryController } from '../controllers/InventoryController.js';

export default function BajasTableViewModal({
  isOpen,
  onClose,
  title = 'Tabla de Bajas',
  subtitle = '',
  items = [],
  onCancelBaja = null,
  onExportExcel = null,
  batchDetails = null
}) {
  const [localItems, setLocalItems] = useState(items);
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('ALL');
  const [copiedSerial, setCopiedSerial] = useState(null);

  // Estados para asignación rápida / edición de nombres (solicita y entrega)
  const [editingItemForPersonas, setEditingItemForPersonas] = useState(null);
  const [editRequesterVal, setEditRequesterVal] = useState('');
  const [editDispatcherVal, setEditDispatcherVal] = useState('OPERADOR');
  const [isSavingPersonas, setIsSavingPersonas] = useState(false);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  // Lista única de modelos presentes en las bajas
  const availableModels = useMemo(() => {
    const set = new Set();
    localItems.forEach(it => {
      const m = it.material || it.material_model;
      if (m && m.trim()) set.add(m.trim());
    });
    return Array.from(set).sort();
  }, [localItems]);

  // Filtrado reactivo en tiempo real
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return localItems.filter(it => {
      const serial = (it.serial || it.serial_number || '').toLowerCase();
      const material = (it.material || it.material_model || '').toLowerCase();
      const internal = String(it.internalNumber || it.internal_number || '');
      const wh = (it.warehouseName || it.warehouse_name || '').toLowerCase();
      const row = (it.warehouseRow || it.warehouse_row || '').toLowerCase();
      const space = (it.warehouseSpace || it.warehouse_space || '').toLowerCase();
      const reason = (it.bajaReason || it.reason || '').toLowerCase();
      const reqBy = (it.requestedBy || it.requested_by || '').toLowerCase();
      const dispBy = (it.dispatchedBy || it.dispatched_by || it.operator || '').toLowerCase();

      // Filtro por modelo
      if (modelFilter !== 'ALL' && (it.material || it.material_model) !== modelFilter) {
        return false;
      }

      // Filtro de búsqueda
      if (!q) return true;
      return (
        serial.includes(q) ||
        material.includes(q) ||
        internal.includes(q) ||
        reqBy.includes(q) ||
        dispBy.includes(q) ||
        wh.includes(q) ||
        row.includes(q) ||
        space.includes(q) ||
        reason.includes(q)
      );
    });
  }, [localItems, searchQuery, modelFilter]);

  // Ordenar de la más nueva a la más vieja de forma estricta por fecha/hora
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const rawA = a.scannedAt || a.bajaAt || a.departure_date || a.assignedAt;
      const rawB = b.scannedAt || b.bajaAt || b.departure_date || b.assignedAt;
      const timeA = rawA ? new Date(rawA).getTime() : 0;
      const timeB = rawB ? new Date(rawB).getTime() : 0;
      const validA = !isNaN(timeA) && timeA > 0;
      const validB = !isNaN(timeB) && timeB > 0;
      if (validA && validB && timeA !== timeB) return timeB - timeA;
      if (validA && !validB) return -1;
      if (!validA && validB) return 1;
      const sA = String(a.serial || a.serial_number || '');
      const sB = String(b.serial || b.serial_number || '');
      return sA.localeCompare(sB);
    });
  }, [filteredItems]);

  const handleOpenEditPersonas = (item) => {
    setEditingItemForPersonas(item);
    setEditRequesterVal(item.requestedBy || item.requested_by || 'ROBERTO');
    setEditDispatcherVal(item.dispatchedBy || item.dispatched_by || item.operator || 'OPERADOR');
  };

  const handleSavePersonas = async () => {
    if (!editingItemForPersonas) return;
    const serial = editingItemForPersonas.serial || editingItemForPersonas.serial_number;
    if (!serial) return;

    setIsSavingPersonas(true);
    try {
      const req = (editRequesterVal || '').trim().toUpperCase() || 'Sin especificar';
      const disp = (editDispatcherVal || '').trim().toUpperCase() || 'Operador';

      await InventoryController.updateBajaPersonas(serial, req, disp);

      setLocalItems(prev => prev.map(it => {
        const itSerial = it.serial || it.serial_number;
        if (itSerial === serial) {
          return {
            ...it,
            requestedBy: req,
            requested_by: req,
            dispatchedBy: disp,
            dispatched_by: disp
          };
        }
        return it;
      }));

      setEditingItemForPersonas(null);
    } catch (e) {
      alert("Error guardando personas de la baja: " + e.message);
    } finally {
      setIsSavingPersonas(false);
    }
  };

  const handleCopy = (serial) => {
    if (!serial) return;
    navigator.clipboard?.writeText(serial);
    setCopiedSerial(serial);
    setTimeout(() => {
      setCopiedSerial(prev => (prev === serial ? null : prev));
    }, 2000);
  };

  const handleExport = () => {
    if (onExportExcel) {
      onExportExcel();
    } else if (batchDetails) {
      InventoryController.exportChecklistReportToExcel(batchDetails);
    } else if (items.length > 0) {
      InventoryController.exportDeparturesReportToExcel(filteredItems);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* ENCABEZADO */}
        <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 text-white p-4 sm:p-5 flex justify-between items-start gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl">📊</span>
              <h2 className="text-lg sm:text-xl font-black tracking-tight truncate">
                {title}
              </h2>
              <span className="bg-rose-500/30 text-rose-200 border border-rose-400/30 text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                {items.length} {items.length === 1 ? 'equipo dado de baja' : 'equipos dados de baja'}
              </span>
            </div>
            {subtitle && (
              <p className="text-xs text-rose-200/90 mt-1 truncate">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExport}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="Descargar esta tabla en archivo Excel oficial"
            >
              <span>📥</span>
              <span className="hidden sm:inline">Descargar Excel</span>
            </button>
            <button
              onClick={onClose}
              type="button"
              className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition cursor-pointer text-lg leading-none"
              title="Cerrar ventana"
            >
              ✕
            </button>
          </div>
        </div>

        {/* BARRA DE HERRAMIENTAS / FILTROS (TIPO EXCEL) */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-2xl">
            {/* Buscador reactivo */}
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                🔍
              </span>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por serie, modelo, Santi, ubicación, motivo..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 rounded-xl text-xs font-medium text-slate-800 outline-none"
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

            {/* Filtro por Modelo */}
            {availableModels.length > 1 && (
              <div className="sm:w-56 shrink-0">
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className="w-full py-2 px-3 bg-white border border-slate-300 focus:border-rose-500 rounded-xl text-xs font-semibold text-slate-800 outline-none"
                >
                  <option value="ALL">Todos los Modelos ({availableModels.length})</option>
                  {availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-600 font-semibold flex items-center justify-between sm:justify-end gap-2 shrink-0">
            <span>Mostrando: <strong className="text-rose-800 font-bold">{filteredItems.length}</strong> de {items.length}</span>
            {(searchQuery || modelFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setModelFilter('ALL'); }}
                className="text-[11px] text-rose-700 hover:underline font-bold"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* TABLA PRINCIPAL DE DATOS (ESTILO HOJA DE CÁLCULO) */}
        <div className="overflow-x-auto overflow-y-auto flex-1 bg-white">
          {filteredItems.length === 0 ? (
            <div className="text-center py-16 px-4 bg-slate-50/50">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-xl mb-2">
                📦
              </div>
              <p className="text-sm font-bold text-slate-700">No se encontraron registros de bajas</p>
              <p className="text-xs text-slate-500 mt-1">
                {items.length === 0 
                  ? 'No hay equipos registrados como baja en esta consulta.' 
                  : 'Ningún equipo coincide con el término de búsqueda.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wider sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[130px]">Hora de Detección</th>
                  <th className="py-2.5 px-3 min-w-[110px]">Fecha de Baja</th>
                  <th className="py-2.5 px-3 min-w-[150px]">Número de Serie</th>
                  <th className="py-2.5 px-3 min-w-[160px]">Modelo</th>
                  <th className="py-2.5 px-3 min-w-[90px]"># Santi</th>
                  <th className="py-2.5 px-3 min-w-[150px]">Nombre que solicita</th>
                  <th className="py-2.5 px-3 min-w-[150px]">Persona que entrega</th>
                  <th className="py-2.5 px-3 min-w-[160px]">Motivo</th>
                  {onCancelBaja && (
                    <th className="py-2.5 px-3 w-28 text-center">Acción</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sortedItems.map((item, idx) => {
                  const serial = (item.serial || item.serial_number || '').trim().toUpperCase();
                  const material = item.material || item.material_model || 'Sin Modelo';
                  const internal = item.internalNumber !== undefined && item.internalNumber !== null 
                    ? item.internalNumber 
                    : (item.internal_number || null);
                  const rawTime = item.scannedAt || item.bajaAt || item.departure_date || item.assignedAt;
                  
                  let formattedDate = '-';
                  let formattedTime = '-';
                  if (rawTime) {
                    const d = new Date(rawTime);
                    if (!isNaN(d.getTime())) {
                      formattedDate = d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      formattedTime = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                    }
                  }

                  const whName = item.warehouseName || item.warehouse_name || 'Almacén 1';
                  const whRow = item.warehouseRow || item.warehouse_row || 'Sin Asignar';
                  const whSpace = item.warehouseSpace || item.warehouse_space || '';
                  const systemStatus = item.systemStatus || item.system_status || 'Principal';
                  const reason = item.bajaReason || item.reason || 'Baja de almacén';

                  return (
                    <tr 
                      key={serial || idx}
                      className="hover:bg-rose-50/40 transition-colors group"
                    >
                      {/* Consecutivo */}
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Hora Exacta de Detección */}
                      <td className="py-2.5 px-3 font-mono font-bold text-rose-800">
                        <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-900 border border-rose-200 px-2 py-0.5 rounded-md text-[11px]">
                          <span>🕒</span>
                          <span>{formattedTime}</span>
                        </span>
                      </td>

                      {/* Fecha */}
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">
                        {formattedDate}
                      </td>

                      {/* Número de Serie */}
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span className="select-all">{serial}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(serial)}
                            className="opacity-0 group-hover:opacity-100 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded transition cursor-pointer"
                            title="Copiar serie"
                          >
                            {copiedSerial === serial ? '✓ Copiado' : 'Copiar'}
                          </button>
                        </div>
                      </td>

                      {/* Modelo */}
                      <td className="py-2.5 px-3 text-slate-700 font-semibold truncate max-w-[200px]" title={material}>
                        {material}
                      </td>

                      {/* # Santi */}
                      <td className="py-2.5 px-3">
                        {internal ? (
                          <span className="bg-slate-800 text-white font-bold text-[10px] px-1.5 py-0.5 rounded">
                            #{internal}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Nombre que solicita */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditPersonas(item)}
                            className="inline-flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 hover:border-amber-300 px-2 py-0.5 rounded-md text-[11px] font-bold transition text-left cursor-pointer group/btn"
                            title="Haz clic para modificar o asignar el nombre del solicitante"
                          >
                            <span>👤</span>
                            <span>{item.requestedBy || item.requested_by || 'Sin especificar'}</span>
                            <span className="opacity-0 group-hover/btn:opacity-100 text-[10px] text-amber-700 ml-0.5">✏️</span>
                          </button>
                        </div>
                      </td>

                      {/* Persona que entrega / da el producto */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditPersonas(item)}
                            className="inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 hover:border-blue-300 px-2 py-0.5 rounded-md text-[11px] font-bold transition text-left cursor-pointer group/btn"
                            title="Haz clic para modificar o asignar el nombre de quien entrega"
                          >
                            <span>🚚</span>
                            <span>{item.dispatchedBy || item.dispatched_by || item.operator || 'Operador'}</span>
                            <span className="opacity-0 group-hover/btn:opacity-100 text-[10px] text-blue-700 ml-0.5">✏️</span>
                          </button>
                        </div>
                      </td>

                      {/* Motivo */}
                      <td className="py-2.5 px-3 text-slate-600 italic text-[11px] truncate max-w-[180px]" title={reason}>
                        {reason}
                      </td>

                      {/* Acción Opcional: Cancelar Baja */}
                      {onCancelBaja && (
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => onCancelBaja(serial)}
                            className="text-[11px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-2.5 py-1 rounded-lg font-bold transition flex items-center justify-center gap-1 cursor-pointer mx-auto"
                            title="Cancelar baja y regresar la serie a disponible"
                          >
                            <span>↩</span>
                            <span>Cancelar</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* PIE DE PÁGINA */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500 text-center sm:text-left">
            Total en consulta: <strong className="text-slate-800">{filteredItems.length}</strong> de <strong className="text-slate-800">{items.length}</strong> equipos.
            Las horas corresponden al momento exacto en que se detectó/escaneó la baja.
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span>📥</span>
              <span>Exportar a Excel</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>

      </div>

      {/* MODAL PARA EDITAR / ASIGNAR NOMBRES DE LA BAJA */}
      {editingItemForPersonas && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">✏️</span>
                <h3 className="text-sm font-black text-slate-800">
                  Asignar Solicitante y Despachador
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingItemForPersonas(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-4 text-xs font-mono">
              <p className="text-slate-500 text-[10px] uppercase font-sans font-bold">Número de Serie:</p>
              <p className="text-sm font-black text-slate-900">{editingItemForPersonas.serial || editingItemForPersonas.serial_number}</p>
              <p className="text-slate-500 text-[10px] uppercase font-sans font-bold mt-1">Modelo:</p>
              <p className="font-sans font-semibold text-slate-700">{editingItemForPersonas.material || editingItemForPersonas.material_model}</p>
            </div>

            <div className="space-y-3 text-xs mb-5">
              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <span>👤</span>
                  <span>Nombre de la persona que solicita:</span>
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={editRequesterVal}
                    onChange={(e) => setEditRequesterVal(e.target.value.toUpperCase())}
                    placeholder="Ej. ROBERTO, DANIEL..."
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-xl font-bold uppercase text-slate-800 outline-none focus:border-rose-500 text-xs"
                    autoFocus
                  />
                  <select
                    value={editRequesterVal}
                    onChange={(e) => setEditRequesterVal(e.target.value)}
                    className="bg-slate-100 border border-slate-300 rounded-xl px-2 text-[11px] font-semibold text-slate-700 outline-none"
                  >
                    <option value="ROBERTO">ROBERTO</option>
                    <option value="DANIEL">DANIEL</option>
                    <option value="JESUS">JESUS</option>
                    <option value="ADRIAN">ADRIAN</option>
                    <option value="VENTAS">VENTAS</option>
                    <option value="TALLER">TALLER</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <span>🚚</span>
                  <span>Persona que entrega / da el producto:</span>
                </label>
                <input
                  type="text"
                  value={editDispatcherVal}
                  onChange={(e) => setEditDispatcherVal(e.target.value.toUpperCase())}
                  placeholder="Ej. OPERADOR, ALMACÉN..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold uppercase text-slate-800 outline-none focus:border-rose-500 text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingItemForPersonas(null)}
                className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSavePersonas}
                disabled={isSavingPersonas}
                className="flex-1 py-2 px-3 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-bold text-xs transition shadow-xs flex items-center justify-center gap-1.5"
              >
                <span>💾</span>
                <span>{isSavingPersonas ? 'Guardando...' : 'Guardar Datos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
