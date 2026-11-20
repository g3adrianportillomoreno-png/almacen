import { useState, useEffect, useCallback } from 'react';
import { CheckpointService, TOTAL_SLOTS } from '../services/CheckpointService.js';
import { InventoryRepository } from '../services/InventoryRepository.js';

export default function CheckpointModal({
  isOpen,
  onClose,
  category = 'MASTER', // 'MASTER' | 'RECEPTIONS'
  currentPrinters = [],
  currentBatches = [],
  onRestored
}) {
  const isMaster = category === 'MASTER';
  const categoryTitle = isMaster ? 'Inventario Maestro' : 'Recepciones de Entrada';

  const [slots, setSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(true);

  // Estados para Guardar / Sobreescribir
  const [savingSlotIndex, setSavingSlotIndex] = useState(null);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Estados para Restaurar con Contraseña
  const [restoreSlotTarget, setRestoreSlotTarget] = useState(null);
  const [restorePasswordInput, setRestorePasswordInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);

  // Estado para Vaciar / Eliminar slot
  const [deletingSlotIndex, setDeletingSlotIndex] = useState(null);

  // Cargar slots al abrir
  const loadSlots = useCallback(async () => {
    setIsLoadingSlots(true);
    try {
      const loaded = await CheckpointService.getSlots(category);
      setSlots(loaded);
    } catch (e) {
      console.warn('Error cargando slots:', e);
    } finally {
      setIsLoadingSlots(false);
    }
  }, [category]);

  useEffect(() => {
    if (isOpen) {
      loadSlots();
      setSavingSlotIndex(null);
      setSaveNameInput('');
      setRestoreSlotTarget(null);
      setRestorePasswordInput('');
      setRestoreError(null);
      setDeletingSlotIndex(null);
    }
  }, [isOpen, loadSlots]);

  if (!isOpen) return null;

  // Manejar Guardado manual en un slot
  const handleStartSave = (slotIndex, existingName = '') => {
    setSavingSlotIndex(slotIndex);
    const defaultLabel = existingName || (
      isMaster 
        ? `Maestro (${currentPrinters.length} equipos - ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })})`
        : `Recepciones (${currentBatches.length} lotes - ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })})`
    );
    setSaveNameInput(defaultLabel);
  };

  const handleConfirmSave = async (e) => {
    e.preventDefault();
    if (savingSlotIndex === null) return;

    setIsSaving(true);
    try {
      if (isMaster) {
        if (!currentPrinters || currentPrinters.length === 0) {
          alert('No se puede crear un punto de restauración vacío sin inventario cargado.');
          setIsSaving(false);
          return;
        }

        // Snapshot de Maestro
        const printersData = (currentPrinters || []).map(p => ({
          serial: (p.serial || '').trim().toUpperCase(),
          material: p.material || 'MODELO GENERAL',
          internalNumber: p.internalNumber !== undefined ? p.internalNumber : null,
          warehouseName: p.warehouseName || 'Almacén 1',
          warehouseRow: p.warehouseRow || 'Sin Asignar',
          warehouseSpace: p.warehouseSpace || null,
          systemStatus: p.systemStatus || 'Principal',
          printerStatus: p.status || p.printerStatus || 'DISPONIBLE',
          assignedAt: p.assignedAt || null
        }));

        const cache = InventoryRepository.getMetadataCache();
        const snapshot = {
          printers: printersData,
          serialsCache: cache.serials || {}
        };

        await CheckpointService.saveCheckpoint(
          'MASTER',
          savingSlotIndex,
          saveNameInput,
          snapshot,
          printersData.length
        );
      } else {
        if (!currentBatches || currentBatches.length === 0) {
          alert('No se puede crear un punto de restauración vacío sin lotes de recepción.');
          setIsSaving(false);
          return;
        }

        // Snapshot de Recepciones
        const batchesData = (currentBatches || []).map(b => ({
          id: b.id,
          name: b.name,
          folio: b.folio,
          consecutiveNumber: b.consecutiveNumber,
          status: b.status,
          createdAt: b.createdAt,
          expectedSeries: (b.expectedSeries || []).map(s => ({
            serial: s.serial || s.serial_number,
            material: s.material || s.material_model,
            internalNumber: s.internalNumber || s.internal_number,
            warehouseName: s.warehouseName || s.warehouse_name,
            warehouseRow: s.warehouseRow || s.warehouse_row,
            warehouseSpace: s.warehouseSpace || s.warehouse_space,
            systemStatus: s.systemStatus || s.system_status,
            printerStatus: s.printerStatus || s.printer_status,
            isScanned: Boolean(s.isScanned || s.is_scanned),
            scannedAt: s.scannedAt || s.scanned_at,
            assignedAt: s.assignedAt || s.assigned_at
          })),
          unexpectedLogs: (b.unexpectedLogs || []).map(u => ({
            scannedValue: u.scannedValue || u.scanned_value || String(u),
            createdAt: u.createdAt || u.created_at
          }))
        }));

        const cache = InventoryRepository.getMetadataCache();
        const totalItems = batchesData.reduce((acc, b) => acc + (b.expectedSeries?.length || 0), 0);
        const snapshot = {
          batches: batchesData,
          checklistsCache: cache.checklists || {}
        };

        await CheckpointService.saveCheckpoint(
          'RECEPTIONS',
          savingSlotIndex,
          saveNameInput,
          snapshot,
          totalItems
        );
      }

      setSavingSlotIndex(null);
      setSaveNameInput('');
      await loadSlots();
    } catch (err) {
      alert('Error guardando checkpoint: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Manejar Eliminación de slot
  const handleConfirmDelete = async (slotIndex) => {
    try {
      await CheckpointService.deleteCheckpoint(category, slotIndex);
      setDeletingSlotIndex(null);
      await loadSlots();
    } catch (err) {
      alert('Error al liberar espacio: ' + err.message);
    }
  };

  // Manejar Restauración
  const handleStartRestore = (slot) => {
    setRestoreSlotTarget(slot);
    setRestorePasswordInput('');
    setRestoreError(null);
  };

  const handleConfirmRestore = async (e) => {
    e.preventDefault();
    if (!restoreSlotTarget) return;

    if (!CheckpointService.verifyPassword(restorePasswordInput)) {
      setRestoreError('Contraseña incorrecta. Se requiere autorización con la clave correcta.');
      return;
    }

    setIsRestoring(true);
    setRestoreError(null);

    try {
      if (isMaster) {
        const res = await CheckpointService.restoreMasterCheckpoint(
          restoreSlotTarget.slotIndex,
          restorePasswordInput
        );
        alert(`✓ Checkpoint restaurado con éxito:\n\nSe restableció el Inventario Maestro (${res.restoredCount} equipos) al estado guardado en el Espacio #${restoreSlotTarget.slotIndex}.`);
      } else {
        const res = await CheckpointService.restoreReceptionsCheckpoint(
          restoreSlotTarget.slotIndex,
          restorePasswordInput
        );
        alert(`✓ Checkpoint restaurado con éxito:\n\nSe restablecieron las Recepciones (${res.restoredBatchesCount} lotes, ${res.totalRestoredSeries} equipos) al estado guardado en el Espacio #${restoreSlotTarget.slotIndex}.`);
      }

      setRestoreSlotTarget(null);
      setRestorePasswordInput('');
      onClose();
      if (onRestored) onRestored();
    } catch (err) {
      setRestoreError(err.message || 'Error al restaurar');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* ENCABEZADO */}
        <div className={`p-5 border-b flex justify-between items-start ${
          isMaster 
            ? 'bg-gradient-to-r from-purple-700 to-indigo-800 text-white border-purple-800' 
            : 'bg-gradient-to-r from-amber-600 to-orange-700 text-white border-amber-700'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💾</span>
              <h2 className="text-lg font-black tracking-tight">
                Puntos de Restauración (Checkpoints)
              </h2>
            </div>
            <p className="text-xs opacity-90 mt-1">
              {categoryTitle} &bull; Tienes exactamente <strong>{TOTAL_SLOTS} espacios independientes</strong> para guardar y regresar si hubo algún error.
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition cursor-pointer text-lg leading-none"
            title="Cerrar ventana"
          >
            ✕
          </button>
        </div>

        {/* CONTENIDO PRINCIPAL: LISTA DE LOS 5 ESPACIOS */}
        <div className="p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50">
          
          {/* Banner de estado actual */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs">
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-800">Estado actual listo para respaldar: </span>
              {isMaster ? (
                <span><strong>{currentPrinters.length}</strong> equipos en Inventario Maestro</span>
              ) : (
                <span><strong>{currentBatches.length}</strong> lotes de recepción</span>
              )}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">
              Control 100% manual por espacios
            </div>
          </div>

          {isLoadingSlots ? (
            <div className="p-8 text-center text-sm font-medium text-slate-500">
              Cargando espacios de guardado...
            </div>
          ) : (
            <div className="space-y-3">
              {slots.map((slot) => {
                const isOccupied = !slot.isEmpty;
                const isEditingThisSlot = savingSlotIndex === slot.slotIndex;
                const isDeletingThisSlot = deletingSlotIndex === slot.slotIndex;

                return (
                  <div
                    key={slot.slotIndex}
                    className={`rounded-xl border transition-all p-4 ${
                      isOccupied 
                        ? 'bg-white border-slate-300 shadow-xs' 
                        : 'bg-slate-100/60 border-dashed border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    {/* MODO EDICIÓN / GUARDADO EN ESTE SLOT */}
                    {isEditingThisSlot ? (
                      <form onSubmit={handleConfirmSave} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
                            {isOccupied ? `Sobreescribir Espacio #${slot.slotIndex}` : `Guardar en Espacio #${slot.slotIndex}`}
                          </span>
                          <span className="text-xs text-slate-500">
                            {isMaster ? `${currentPrinters.length} equipos` : `${currentBatches.length} lotes`}
                          </span>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                            Nombre o Nota del Checkpoint:
                          </label>
                          <input
                            type="text"
                            required
                            autoFocus
                            placeholder="Ej. Previo a reorganizar Fila 2, o Antes de subir Excel..."
                            value={saveNameInput}
                            onChange={(e) => setSaveNameInput(e.target.value)}
                            className="w-full bg-white border border-purple-300 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setSavingSlotIndex(null)}
                            disabled={isSaving}
                            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={isSaving}
                            className={`text-xs px-4 py-1.5 rounded-lg font-bold text-white shadow-xs transition cursor-pointer ${
                              isMaster ? 'bg-purple-600 hover:bg-purple-500' : 'bg-amber-600 hover:bg-amber-500'
                            } ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {isSaving ? 'Guardando snapshot...' : 'Confirmar y Guardar'}
                          </button>
                        </div>
                      </form>
                    ) : isDeletingThisSlot ? (
                      /* CONFIRMACIÓN DE VACIAR/LIBERAR SLOT */
                      <div className="space-y-2.5">
                        <div className="text-xs font-bold text-rose-700">
                          ¿Estás seguro de liberar y vaciar el Espacio #{slot.slotIndex}?
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Se eliminará el respaldo <strong>"{slot.name}"</strong> para dejar libre este espacio. Esta acción no se puede deshacer.
                        </p>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setDeletingSlotIndex(null)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(slot.slotIndex)}
                            className="text-xs px-3 py-1.5 rounded-lg font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition cursor-pointer"
                          >
                            Sí, Vaciar Espacio
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* VISTA NORMAL DEL SLOT */
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            isOccupied
                              ? isMaster ? 'bg-purple-100 text-purple-800' : 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            #{slot.slotIndex}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {isOccupied ? slot.name : 'Espacio Libre'}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                isOccupied
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}>
                                {isOccupied ? 'Guardado' : 'Disponible'}
                              </span>
                            </div>

                            {isOccupied ? (
                              <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                                <span>
                                  🕒 {new Date(slot.createdAt).toLocaleString('es-MX', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  })}
                                </span>
                                <span>&bull;</span>
                                <span className="font-semibold text-slate-700">
                                  📦 {slot.itemCount} {isMaster ? 'equipos' : 'equipos en lotes'}
                                </span>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Puedes guardar aquí una instantánea para poder regresar cuando lo necesites.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* BOTONES DE ACCIÓN PARA ESTE SLOT */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {isOccupied ? (
                            <>
                              <button
                                type="button"
                                disabled={!slot.itemCount || slot.itemCount === 0}
                                onClick={() => handleStartRestore(slot)}
                                className={`text-xs font-bold py-1.5 px-3 rounded-lg text-white shadow-2xs transition flex items-center gap-1 ${
                                  !slot.itemCount || slot.itemCount === 0
                                    ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                                    : (isMaster ? 'bg-purple-600 hover:bg-purple-500 cursor-pointer' : 'bg-amber-600 hover:bg-amber-500 cursor-pointer')
                                }`}
                                title={!slot.itemCount || slot.itemCount === 0 ? "Este espacio no contiene registros válidos para restaurar" : "Regresar al estado guardado en este espacio"}
                              >
                                <span>↺</span>
                                <span>Restaurar</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStartSave(slot.slotIndex, slot.name)}
                                className="text-xs font-medium py-1.5 px-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                                title="Actualizar este espacio con el estado actual"
                              >
                                Sobreescribir
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeletingSlotIndex(slot.slotIndex)}
                                className="text-xs py-1.5 px-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                title="Liberar este espacio"
                              >
                                🗑️
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartSave(slot.slotIndex)}
                              className="text-xs font-bold py-1.5 px-3.5 rounded-lg bg-white border border-slate-300 hover:border-slate-400 text-slate-700 hover:bg-slate-50 transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <span>💾</span>
                              <span>Guardar Aquí</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PIE DEL MODAL */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Los checkpoints de <strong>{categoryTitle}</strong> son 100% independientes y no afectan otros módulos.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* DIÁLOGO MODAL SECUNDARIO: CONFIRMAR RESTAURACIÓN CON CONTRASEÑA */}
      {restoreSlotTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 bg-rose-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔐</span>
                <h3 className="text-sm font-bold tracking-tight">
                  Autorización de Restauración
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRestoreSlotTarget(null)}
                className="text-white/80 hover:text-white p-1 cursor-pointer leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmRestore} className="p-5 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <div className="text-xs font-bold text-amber-900">
                  ⚠️ Atención: Estás a punto de regresar datos
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Se restaurará el estado del <strong>Espacio #{restoreSlotTarget.slotIndex}</strong> ({restoreSlotTarget.name}). 
                  Los datos actuales de <strong>{categoryTitle}</strong> serán reemplazados por este respaldo.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Contraseña de Autorización:
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  placeholder="Ingresa la contraseña..."
                  value={restorePasswordInput}
                  onChange={(e) => {
                    setRestorePasswordInput(e.target.value);
                    if (restoreError) setRestoreError(null);
                  }}
                  className="w-full bg-white border border-slate-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 outline-none"
                />
                {restoreError && (
                  <p className="text-[11px] font-bold text-rose-600 mt-1.5">
                    {restoreError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRestoreSlotTarget(null)}
                  disabled={isRestoring}
                  className="text-xs px-3 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isRestoring}
                  className={`text-xs px-4 py-2 rounded-xl font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer ${
                    isRestoring ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  {isRestoring ? 'Restaurando datos...' : 'Confirmar y Restaurar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
