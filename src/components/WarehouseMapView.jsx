import { useState, useRef, useEffect, useMemo } from 'react';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import { InventoryController } from '../controllers/InventoryController.js';

export default function WarehouseMapView({ 
  checklists = [], 
  onLayoutChange 
}) {
  // Extraer todas las impresoras de todos los lotes
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(checklists);
  }, [checklists]);

  const [mapModel, setMapModel] = useState(() => {
    const loaded = WarehouseMapController.loadMap();
    return WarehouseMapController.syncWarehousesFromPrinters(loaded, allPrinters);
  });
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Sincronizar el modelo del mapa cuando cambien los checklists (nuevos almacenes y filas creados al capturar)
  useEffect(() => {
    const loaded = WarehouseMapController.loadMap();
    const synced = WarehouseMapController.syncWarehousesFromPrinters(loaded, allPrinters);
    setMapModel(synced);
  }, [checklists, allPrinters]);

  // Edición del nombre de la fila
  const [editingRowId, setEditingRowId] = useState(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Edición del nombre del almacén / mapa
  const [isEditingWarehouseName, setIsEditingWarehouseName] = useState(false);
  const [warehouseNameValue, setWarehouseNameValue] = useState('');

  const [newRowName, setNewRowName] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddWhModal, setShowAddWhModal] = useState(false);
  const [newWhName, setNewWhName] = useState('');
  const [savedAlert, setSavedAlert] = useState(false);

  const canvasRef = useRef(null);

  // Almacén activo actualmente
  const activeWarehouse = useMemo(() => {
    return mapModel.getActiveWarehouse();
  }, [mapModel]);

  // Calcular estadísticas y rangos numéricos para cada fila del almacén activo
  const statsMap = useMemo(() => {
    return WarehouseMapController.getStatsForAllRows(mapModel, allPrinters);
  }, [mapModel, allPrinters]);

  // Manejo de arrastre (Drag & Drop de rectángulos compactos)
  const handleMouseDown = (e, row) => {
    if (e.target.closest('button') || e.target.closest('input')) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    setDraggingId(row.id);
    setDragOffset({
      x: e.clientX - canvasRect.left - row.x,
      y: e.clientY - canvasRect.top - row.y
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingId || !canvasRef.current) return;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const newX = Math.max(10, Math.min(canvasRect.width - 200, e.clientX - canvasRect.left - dragOffset.x));
      const newY = Math.max(10, Math.min(canvasRect.height - 130, e.clientY - canvasRect.top - dragOffset.y));

      setMapModel(prev => prev.updateRowPosition(draggingId, { x: newX, y: newY }));
    };

    const handleMouseUp = () => {
      if (draggingId) {
        setDraggingId(null);
        WarehouseMapController.saveMap(mapModel);
        if (onLayoutChange) onLayoutChange();
      }
    };

    if (draggingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, dragOffset, mapModel, onLayoutChange]);

  // Cambiar almacén (Almacén 1, Almacén 2, etc.)
  const handleSelectWarehouse = (whId) => {
    const updated = WarehouseMapController.changeActiveWarehouse(mapModel, whId);
    setMapModel(updated);
    if (onLayoutChange) onLayoutChange();
  };

  // Renombrar el almacén o título del mapa
  const handleStartRenameWarehouse = () => {
    setIsEditingWarehouseName(true);
    setWarehouseNameValue(activeWarehouse?.name || 'Almacén 1');
  };

  const handleSaveRenameWarehouse = (e) => {
    e.preventDefault();
    if (!warehouseNameValue.trim()) return;
    const updated = WarehouseMapController.renameWarehouse(mapModel, activeWarehouse.id, warehouseNameValue.trim());
    setMapModel(updated);
    setIsEditingWarehouseName(false);
    if (onLayoutChange) onLayoutChange();
  };

  // Renombrar una fila específica
  const handleStartRenameRow = (row, e) => {
    e.stopPropagation();
    setEditingRowId(row.id);
    setEditNameValue(row.name);
  };

  const handleSaveRenameRow = (rowId, e) => {
    if (e) e.preventDefault();
    if (!editNameValue.trim()) return;
    const updated = WarehouseMapController.renameRow(mapModel, rowId, editNameValue.trim());
    setMapModel(updated);
    setEditingRowId(null);
    if (onLayoutChange) onLayoutChange();
  };

  const handleAddRow = (e) => {
    e.preventDefault();
    if (!newRowName.trim()) return;
    const updated = WarehouseMapController.addNewRow(mapModel, newRowName.trim());
    setMapModel(updated);
    setNewRowName('');
    setShowAddModal(false);
    if (onLayoutChange) onLayoutChange();
  };

  const handleAddWarehouse = (e) => {
    e.preventDefault();
    if (!newWhName.trim()) return;
    const updated = WarehouseMapController.addNewWarehouse(mapModel, newWhName.trim());
    setMapModel(updated);
    setNewWhName('');
    setShowAddWhModal(false);
    if (onLayoutChange) onLayoutChange();
  };

  const handleDeleteRow = (rowId, e) => {
    e.stopPropagation();
    if (window.confirm('¿Deseas eliminar este rectángulo de Fila del plano?')) {
      const updated = WarehouseMapController.deleteRow(mapModel, rowId);
      setMapModel(updated);
      if (onLayoutChange) onLayoutChange();
    }
  };

  const handleDeleteActiveWarehouse = () => {
    if (mapModel.warehouses.length <= 1) return;
    if (window.confirm(`¿Deseas eliminar la pestaña del almacén "${activeWarehouse.name}" y su plano del mapa?`)) {
      const updated = WarehouseMapController.deleteWarehouse(mapModel, activeWarehouse.id);
      setMapModel(updated);
      if (onLayoutChange) onLayoutChange();
    }
  };

  const handleManualSave = () => {
    WarehouseMapController.saveMap(mapModel);
    setSavedAlert(true);
    setTimeout(() => setSavedAlert(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 w-full h-full">
      {/* Selector de Almacenes (Almacén 1, Almacén 2...) y Renombrar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-1.5">
          {mapModel.warehouses.map((wh) => (
            <button
              key={wh.id}
              onClick={() => handleSelectWarehouse(wh.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                wh.id === activeWarehouse.id
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <svg className="w-3.5 h-3.5 text-current opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              {wh.name}
            </button>
          ))}

          <button
            onClick={() => setShowAddWhModal(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-600 border border-dashed border-slate-300 hover:bg-slate-50 transition"
            title="Agregar otro almacén"
          >
            + Almacén
          </button>
        </div>

        {/* Renombrar o Eliminar el Almacén / Mapa activo */}
        <div className="flex items-center gap-1.5">
          {isEditingWarehouseName ? (
            <form onSubmit={handleSaveRenameWarehouse} className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={warehouseNameValue}
                onChange={(e) => setWarehouseNameValue(e.target.value)}
                className="bg-white border border-slate-400 rounded-md px-2 py-0.5 text-xs font-medium text-slate-800"
              />
              <button type="submit" className="bg-slate-800 text-white text-xs px-2 py-0.5 rounded font-medium">
                OK
              </button>
              <button 
                type="button" 
                onClick={() => setIsEditingWarehouseName(false)} 
                className="text-slate-400 hover:text-slate-600 text-xs px-1"
              >
                ✕
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={handleStartRenameWarehouse}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 transition"
                title="Cambiar nombre del almacén o mapa"
              >
                <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span>{activeWarehouse.name}</span>
              </button>

              {mapModel.warehouses.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeleteActiveWarehouse}
                  className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 border border-slate-200 transition"
                  title={`Eliminar almacén "${activeWarehouse.name}" del mapa`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Controles del mapa */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-slate-500 font-medium">
          Filas en plano: <strong className="text-slate-700 font-semibold">{mapModel.rows.length}</strong>
        </span>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded-lg text-xs transition border border-slate-200 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva Fila
          </button>
          <button
            onClick={handleManualSave}
            className="bg-slate-800 hover:bg-slate-900 text-white font-medium px-2.5 py-1 rounded-lg text-xs transition shadow-xs flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Guardar
          </button>
        </div>
      </div>

      {savedAlert && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          Acomodo guardado con éxito
        </div>
      )}

      {/* LIENZO INTERACTIVO DEL MAPA */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[520px]">
        <div 
          ref={canvasRef} 
          className="relative w-full h-full min-h-[520px] bg-slate-50/60 overflow-auto select-none"
          style={{
            backgroundImage: 'radial-gradient(#e2e8f0 1.5px, transparent 1.5px)',
            backgroundSize: '24px 24px'
          }}
        >
          {mapModel.rows.map((row) => {
            const stats = statsMap[row.name] || {
              totalCount: 0,
              consultasCount: 0,
              bajasCount: 0,
              models: [],
              numberRangeText: 'Sin numerar'
            };

            const isDragging = draggingId === row.id;
            const isEditing = editingRowId === row.id;

            return (
              <div
                key={row.id}
                onMouseDown={(e) => handleMouseDown(e, row)}
                style={{
                  position: 'absolute',
                  left: `${row.x}px`,
                  top: `${row.y}px`,
                  width: `${row.width || 190}px`,
                  minHeight: `${row.height || 120}px`,
                  zIndex: isDragging ? 30 : 10
                }}
                className={`rounded-xl border transition-shadow cursor-grab active:cursor-grabbing p-3 flex flex-col justify-between select-none ${
                  isDragging 
                    ? 'shadow-lg ring-2 ring-blue-400 border-blue-500 bg-white z-40' 
                    : stats.consultasCount > 0
                    ? 'bg-amber-50/50 border-amber-300 hover:border-amber-400 shadow-xs'
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                {/* Cabecera: Nombre de la Fila (Modificable) */}
                <div>
                  <div className="flex justify-between items-center gap-1 mb-1.5">
                    {isEditing ? (
                      <form onSubmit={(e) => handleSaveRenameRow(row.id, e)} className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          autoFocus
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          className="w-full bg-white border border-slate-400 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-800 uppercase"
                        />
                        <button type="submit" className="text-xs bg-slate-800 text-white px-1.5 py-0.5 rounded font-medium">
                          OK
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setEditingRowId(null)} 
                          className="text-xs text-slate-400 px-1"
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                        <h4 className="font-semibold text-slate-800 text-xs uppercase tracking-wide truncate">
                          {row.name}
                        </h4>
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameRow(row, e)}
                          className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition"
                          title="Cambiar nombre de la fila"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-medium px-1.5 py-0.5 rounded">
                          {stats.totalCount} eqs
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteRow(row.id, e)}
                          className="text-slate-300 hover:text-rose-500 text-xs p-0.5 rounded transition"
                          title="Eliminar fila"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  {/* RANGO DE ESPACIOS ASIGNADOS EN ESTA FILA (EJ: 1 D - 19 D o 1 - 20) */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mt-1">
                    <span className="block text-[9px] text-slate-500 font-medium uppercase tracking-wider">
                      Rango de Espacios:
                    </span>
                    <p 
                      className="font-bold text-sm text-slate-800 truncate" 
                      title={stats.numberRangeText + (stats.spacesList?.length > 1 ? ` (Espacios: ${stats.spacesList.join(', ')})` : '')}
                    >
                      {stats.numberRangeText}
                    </p>
                  </div>
                </div>

                {/* Modelos y estado */}
                <div className="mt-2 pt-1.5 border-t border-slate-100 flex flex-col gap-1">
                  <div className="text-[10px] text-slate-500 font-normal truncate">
                    {stats.models.length > 0 ? (
                      <span>Mod: <strong className="text-slate-700 font-medium">{stats.models.join(', ')}</strong></span>
                    ) : (
                      <span className="text-slate-400 italic">Sin equipos</span>
                    )}
                  </div>

                  {stats.consultasCount > 0 && (
                    <div className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      {stats.consultasCount} en Consulta
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal para Agregar Nueva Fila */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleAddRow}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 animate-fade-in-up"
          >
            <h3 className="text-sm font-bold text-slate-800 mb-1">
              Agregar Fila a {activeWarehouse.name}
            </h3>
            <p className="text-xs text-slate-500 mb-3 font-normal">
              Ingresa el nombre o identificador de la nueva fila:
            </p>

            <input
              type="text"
              required
              autoFocus
              className="w-full border border-slate-300 focus:border-slate-800 rounded-xl p-2.5 text-xs font-semibold uppercase mb-4"
              placeholder="EJ: FILA 5, RACK D, PASILLO 3..."
              value={newRowName}
              onChange={(e) => setNewRowName(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition shadow-xs"
              >
                Crear Rectángulo
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal para Agregar Nuevo Almacén */}
      {showAddWhModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleAddWarehouse}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 animate-fade-in-up"
          >
            <h3 className="text-sm font-bold text-slate-800 mb-1">
              Crear Nuevo Almacén / Mapa
            </h3>
            <p className="text-xs text-slate-500 mb-3 font-normal">
              Ingresa el nombre del nuevo almacén:
            </p>

            <input
              type="text"
              required
              autoFocus
              className="w-full border border-slate-300 focus:border-slate-800 rounded-xl p-2.5 text-xs font-semibold uppercase mb-4"
              placeholder="EJ: ALMACÉN 3, NAVE SECUNDARIA..."
              value={newWhName}
              onChange={(e) => setNewWhName(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddWhModal(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition shadow-xs"
              >
                Crear Almacén
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
