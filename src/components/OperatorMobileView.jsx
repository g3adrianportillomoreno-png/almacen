import { useState, useMemo, useRef } from 'react';
import CameraScanner from './CameraScanner.jsx';
import SerialSimilarityModal from './SerialSimilarityModal.jsx';
import SimilarPrintersModal from './SimilarPrintersModal.jsx';
import SpaceCollisionModal from './SpaceCollisionModal.jsx';
import useBarcodeScanner from '../hooks/useBarcodeScanner.js';
import { InventoryController } from '../controllers/InventoryController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import { findSerialMatch, findSimilarSerialMatches, findSimilarCandidates, extractSerialFromScanned } from '../utils/serialMatcher.js';
import { soundEffects, isSoundMuted, toggleSoundMute } from '../utils/soundEffects.js';
import { getNextSpace, adjustNumericRow, adjustNumericSpace } from '../utils/locationUtils.js';
import MercadoLibreScanView from './MercadoLibreScanView.jsx';
import BajasSessionView from './BajasSessionView.jsx';
import OfflineSyncBanner from './OfflineSyncBanner.jsx';
import useOfflineSync from '../hooks/useOfflineSync.js';

export default function OperatorMobileView({
  batches = [],
  isLoading = false,
  onRefreshData,
  onCompleteTrailer,
  onLogUnexpected,
  onReconcileSimilar,
  onAssignmentSaved,
  onRequestAdminView,
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4'],
  mlBatches = [],
  onRecordMlScan,
  onRecordMlUnexpected,
  onRefreshMl,
  onForceFinishMlBatch
}) {
  const [soundMuted, setSoundMuted] = useState(() => isSoundMuted());
  const { isOnline, pendingCount, isSyncing, syncNow } = useOfflineSync();

  // Pestaña activa del operador: 'reading' (Lectura libre / Ubicar), 'checklists' (Lotes) o 'mercadolibre'
  const [operatorTab, setOperatorTab] = useState('reading');
  
  // Lote activo si el operador eligió un checklist
  const [activeChecklistId, setActiveChecklistId] = useState(null);

  // Lote activo si el operador eligió Mercado Libre
  const [activeMlBatchId, setActiveMlBatchId] = useState(null);

  // Estados de escaneo y búsqueda
  const [scanInput, setScanInput] = useState('');
  const [activePrinter, setActivePrinter] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [searchTableQuery, setSearchTableQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [notFoundSerial, setNotFoundSerial] = useState('');
  const [showSimilarityModal, setShowSimilarityModal] = useState(false);

  // Estados para el modal de opciones parecidas en SANTI (ceros finales / variaciones)
  const [similarCandidates, setSimilarCandidates] = useState([]);
  const [isSimilarModalOpen, setIsSimilarModalOpen] = useState(false);
  const [scannedSimilarCode, setScannedSimilarCode] = useState('');

  // Estado para el modal de colisión de espacio (Opción 2: Reemplazar, Intercambiar o Compartir)
  const [isCollisionModalOpen, setIsCollisionModalOpen] = useState(false);

  // Filtros de estado y documento para el checklist móvil
  const [checklistStatusFilter, setChecklistStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'SCANNED'
  const [checklistDocFilter, setChecklistDocFilter] = useState('ALL');

  // Formulario táctil de colocación física
  const [selectedWarehouse, setSelectedWarehouse] = useState(availableWarehouses[0] || 'Almacén 1');
  const [selectedRow, setSelectedRow] = useState(availableRows[0] || 'Fila 1');
  const [spaceInput, setSpaceInput] = useState('');
  const [internalNumberInput, setInternalNumberInput] = useState('');
  const [showCustomWarehouse, setShowCustomWarehouse] = useState(false);
  const [customWarehouseInput, setCustomWarehouseInput] = useState('');
  const [showCustomRow, setShowCustomRow] = useState(false);
  const [customRowInput, setCustomRowInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Secuencia de ubicación activa para auto-completar escaneos consecutivos
  const [operatorSequence, setOperatorSequence] = useState(() => ({
    warehouse: availableWarehouses[0] || 'Almacén 1',
    row: availableRows[0] || 'Fila 1',
    space: ''
  }));
  const [mapVersion, setMapVersion] = useState(0);

  const scanInputRef = useRef(null);

  // Checklists reales de recepción (excluyendo maestro)
  const receptionBatches = useMemo(() => {
    return batches.filter(b => !b.isMaster);
  }, [batches]);

  const activeChecklist = useMemo(() => {
    return receptionBatches.find(b => String(b.id) === String(activeChecklistId));
  }, [receptionBatches, activeChecklistId]);

  const activeChecklistMissing = useMemo(() => {
    if (!activeChecklist?.expectedSeries) return [];
    const comp = new Set(activeChecklist.completed || []);
    return activeChecklist.expectedSeries.filter(item => !comp.has(item.serial));
  }, [activeChecklist?.expectedSeries, activeChecklist?.completed]);

  const activeChecklistSimilarMatches = useMemo(() => {
    if (!activeChecklist) return [];
    return findSimilarSerialMatches(activeChecklistMissing, activeChecklist.unexpectedLogs || []);
  }, [activeChecklist, activeChecklistMissing]);

  // Documentos en el checklist activo del operador móvil
  const checklistDistinctDocs = useMemo(() => {
    if (!activeChecklist?.expectedSeries) return [];
    const docs = [];
    activeChecklist.expectedSeries.forEach(item => {
      const doc = item.documentName?.trim();
      if (doc && !docs.includes(doc)) docs.push(doc);
    });
    return docs;
  }, [activeChecklist?.expectedSeries]);

  const checklistDocStats = useMemo(() => {
    if (!activeChecklist?.expectedSeries) return {};
    const stats = {};
    activeChecklist.expectedSeries.forEach(item => {
      const docKey = item.documentName?.trim() || 'General';
      if (!stats[docKey]) stats[docKey] = { total: 0, scanned: 0, pending: 0 };
      stats[docKey].total++;
      if (activeChecklist.completed.includes(item.serial)) {
        stats[docKey].scanned++;
      } else {
        stats[docKey].pending++;
      }
    });
    return stats;
  }, [activeChecklist?.expectedSeries, activeChecklist?.completed]);

  // Series filtradas para el checklist móvil
  const filteredChecklistSeries = useMemo(() => {
    if (!activeChecklist?.expectedSeries) return [];
    return activeChecklist.expectedSeries.filter(item => {
      const isPresent = activeChecklist.completed.includes(item.serial);
      if (checklistStatusFilter === 'PENDING' && isPresent) return false;
      if (checklistStatusFilter === 'SCANNED' && !isPresent) return false;
      if (checklistDocFilter !== 'ALL') {
        const itemDoc = item.documentName?.trim() || 'General';
        if (itemDoc !== checklistDocFilter) return false;
      }
      return true;
    });
  }, [activeChecklist?.expectedSeries, activeChecklist?.completed, checklistStatusFilter, checklistDocFilter]);

  // Agrupadas por documento
  const groupedChecklistSeries = useMemo(() => {
    if (checklistDistinctDocs.length <= 1 || checklistDocFilter !== 'ALL') {
      const key = checklistDocFilter === 'ALL' ? (checklistDistinctDocs[0] || 'General') : checklistDocFilter;
      return { [key]: filteredChecklistSeries };
    }
    const groups = {};
    filteredChecklistSeries.forEach(item => {
      const docKey = item.documentName?.trim() || 'General';
      if (!groups[docKey]) groups[docKey] = [];
      groups[docKey].push(item);
    });
    return groups;
  }, [filteredChecklistSeries, checklistDistinctDocs, checklistDocFilter]);

  const activeMlBatch = useMemo(() => {
    return mlBatches.find(b => String(b.id) === String(activeMlBatchId));
  }, [mlBatches, activeMlBatchId]);

  // Todas las impresoras esperadas del sistema
  const allSystemPrinters = useMemo(() => {
    return InventoryController.extractAllExpectedPrinters(batches);
  }, [batches]);

  // Impresoras ya ubicadas (para validar colisión)
  const placedPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(batches);
  }, [batches]);

  // Equipos sin ubicación física asignada
  const unassignedPrinters = useMemo(() => {
    return allSystemPrinters.filter(p => 
      !p.warehouseSpace || 
      !p.warehouseRow || 
      p.warehouseRow === 'Sin Asignar' || 
      p.warehouseSpace.trim() === ''
    );
  }, [allSystemPrinters]);

  // Opciones de almacén (de props, del mapa persistido, de impresoras existentes y del estado actual)
  const warehouseOptions = useMemo(() => {
    const set = new Set(availableWarehouses);
    try {
      const mapModel = WarehouseMapController.loadMap();
      (mapModel?.warehouses || []).forEach(w => {
        if (w.name && w.name.trim()) set.add(w.name.trim());
      });
    } catch (e) {
      // fallback
    }
    allSystemPrinters.forEach(p => {
      if (p.warehouseName && p.warehouseName.trim()) set.add(p.warehouseName.trim());
    });
    if (selectedWarehouse && selectedWarehouse.trim()) set.add(selectedWarehouse.trim());
    if (operatorSequence.warehouse && operatorSequence.warehouse.trim()) set.add(operatorSequence.warehouse.trim());
    return Array.from(set).filter(Boolean).sort();
  }, [availableWarehouses, allSystemPrinters, selectedWarehouse, operatorSequence.warehouse, mapVersion]);

  // Opciones de fila (de props, del mapa persistido, de impresoras y del estado actual)
  const rowOptions = useMemo(() => {
    const set = new Set(availableRows);
    try {
      const mapModel = WarehouseMapController.loadMap();
      (mapModel?.warehouses || []).forEach(w => {
        (w.rows || []).forEach(r => {
          if (r.name && r.name.trim()) set.add(r.name.trim());
        });
      });
    } catch (e) {
      // fallback
    }
    allSystemPrinters.forEach(p => {
      if (p.warehouseRow && p.warehouseRow.trim() && p.warehouseRow !== 'Sin Asignar') {
        set.add(p.warehouseRow.trim());
      }
    });
    if (selectedRow && selectedRow.trim()) set.add(selectedRow.trim());
    if (operatorSequence.row && operatorSequence.row.trim()) set.add(operatorSequence.row.trim());
    return Array.from(set).filter(Boolean).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [availableRows, allSystemPrinters, selectedRow, operatorSequence.row, mapVersion]);

  // Funciones para agregar nuevos almacenes y filas dinámicamente
  const handleAddNewWarehouse = (customName) => {
    const trimmed = (customName || '').trim();
    if (!trimmed) return;
    try {
      WarehouseMapController.addWarehouseDirect(trimmed);
    } catch (err) {
      console.warn('Error saving new warehouse:', err);
    }
    setSelectedWarehouse(trimmed);
    setOperatorSequence(prev => ({ ...prev, warehouse: trimmed }));
    setShowCustomWarehouse(false);
    setCustomWarehouseInput('');
    setMapVersion(v => v + 1);
  };

  const handleAddNewRow = (customName) => {
    const trimmed = (customName || '').trim();
    if (!trimmed) return;
    try {
      WarehouseMapController.ensureRowExists(trimmed, selectedWarehouse);
    } catch (err) {
      console.warn('Error saving new row:', err);
    }
    setSelectedRow(trimmed);
    setOperatorSequence(prev => ({ ...prev, row: trimmed }));
    setShowCustomRow(false);
    setCustomRowInput('');
    setMapVersion(v => v + 1);
  };

  const handleWarehouseChange = (val) => {
    setSelectedWarehouse(val);
    setOperatorSequence(prev => ({ ...prev, warehouse: val }));
  };

  const handleRowChange = (val) => {
    setSelectedRow(val);
    setOperatorSequence(prev => ({ ...prev, row: val }));
  };

  const handleSpaceChange = (val) => {
    setSpaceInput(val);
    setOperatorSequence(prev => ({ ...prev, space: val }));
  };

  const handleStepRow = (delta) => {
    const currentRow = selectedRow || rowOptions[0] || 'Fila 1';
    const nextRow = adjustNumericRow(currentRow, delta);
    handleRowChange(nextRow);
  };

  const handleStepSpace = (delta) => {
    const currentSpace = spaceInput || '1';
    const nextSpace = adjustNumericSpace(currentSpace, delta);
    handleSpaceChange(nextSpace);
  };

  // Detección de colisión en tiempo real
  const collisionOccupant = useMemo(() => {
    if (!activePrinter) return null;
    const targetSpace = (spaceInput || '').trim().toLowerCase();
    const targetRow = (selectedRow || '').trim().toLowerCase();
    const targetWh = (selectedWarehouse || '').trim().toLowerCase();

    if (!targetSpace || targetSpace === 'general' || !targetRow) return null;

    return placedPrinters.find(p => {
      if (p.serial === activePrinter.serial) return false;
      const pSpace = (p.warehouseSpace || '').trim().toLowerCase();
      const pRow = (p.warehouseRow || '').trim().toLowerCase();
      const pWh = (p.warehouseName || '').trim().toLowerCase();
      return pSpace === targetSpace && pRow === targetRow && pWh === targetWh;
    });
  }, [activePrinter, spaceInput, selectedRow, selectedWarehouse, placedPrinters]);

  // Seleccionar equipo para asignarle ubicación
  const handleSelectPrinter = (printer) => {
    setActivePrinter(printer);
    const hasAssignedWh = printer.warehouseName && printer.warehouseName.trim();
    const hasAssignedRow = printer.warehouseRow && printer.warehouseRow.trim() && printer.warehouseRow !== 'Sin Asignar';
    const hasAssignedSpace = printer.warehouseSpace && printer.warehouseSpace.trim();
    const isAlreadyAssigned = Boolean(hasAssignedWh || hasAssignedRow || hasAssignedSpace);

    if (isAlreadyAssigned) {
      setSelectedWarehouse(printer.warehouseName || operatorSequence.warehouse || warehouseOptions[0] || 'Almacén 1');
      setSelectedRow(hasAssignedRow ? printer.warehouseRow : (operatorSequence.row || rowOptions[0] || 'Fila 1'));
      setSpaceInput(printer.warehouseSpace || '');
    } else {
      // Máquina nueva sin ubicación previa: pre-cargar con la secuencia activa consecutiva
      const targetWh = operatorSequence.warehouse || selectedWarehouse || warehouseOptions[0] || 'Almacén 1';
      const targetRow = operatorSequence.row || selectedRow || rowOptions[0] || 'Fila 1';
      setSelectedWarehouse(targetWh);
      setSelectedRow(targetRow);
      setSpaceInput(operatorSequence.space || '');
    }

    setInternalNumberInput(printer.internalNumber ? String(printer.internalNumber) : '');
    setNotFoundSerial('');
    setSuccessMessage('');
    setShowCustomWarehouse(false);
    setShowCustomRow(false);
  };

  // Procesar código leído por pistola o escáner con coincidencia inteligente
  const handleProcessScan = async (rawCode) => {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) return;

    const candidateSerial = extractSerialFromScanned(code);

    setNotFoundSerial('');
    setSuccessMessage('');

    // Si estamos en un checklist específico: SOLO marcar si está o no está (sin pedir ubicación física)
    if (activeChecklist) {
      const matchInBatch = findSerialMatch(code, activeChecklist.expectedSeries);
      const targetSerial = matchInBatch ? matchInBatch.serial : (candidateSerial || code);

      const isAlreadyDone = matchInBatch
        ? activeChecklist.completed.includes(matchInBatch.serial)
        : activeChecklist.completed.includes(targetSerial);

      if (isAlreadyDone) {
        soundEffects.playScanDuplicate();
        setSuccessMessage(`⚠️ La serie ${targetSerial} YA estaba verificada en este checklist.`);
        setScanInput('');
        return;
      }

      if (matchInBatch) {
        soundEffects.playScanSuccess();
        if ((activeChecklist.completed.length + 1) >= activeChecklist.expectedSeries.length) {
          setTimeout(() => soundEffects.playChecklistCompleted(), 500);
        }
        setSuccessMessage(`✓ ¡SÍ ESTÁ! [${matchInBatch.material || 'EQUIPO'}] Serie: ${matchInBatch.serial}`);
        if (onCompleteTrailer) {
          await onCompleteTrailer(matchInBatch.serial, null, activeChecklist.id);
        }
      } else {
        // Si no coincide exactamente, buscar opciones parecidas en el lote (ej. ceros al final en SANTI)
        const batchCandidates = findSimilarCandidates(code, activeChecklist.expectedSeries);
        if (batchCandidates.length > 0) {
          soundEffects.playScanSuccess();
          setSimilarCandidates(batchCandidates);
          setScannedSimilarCode(candidateSerial || code);
          setIsSimilarModalOpen(true);
        } else {
          soundEffects.playScanError();
          const unexpectedToLog = candidateSerial || code;
          setNotFoundSerial(unexpectedToLog);
          if (onLogUnexpected) {
            await onLogUnexpected(unexpectedToLog, activeChecklist.id);
          }
        }
      }
    } else {
      // Búsqueda global en todo el sistema (Pestaña "Lectura" / Acomodo: aquí SÍ abre el modal para dar ubicación física)
      const match = findSerialMatch(code, allSystemPrinters);
      if (match) {
        soundEffects.playScanSuccess();
        handleSelectPrinter({
          ...match,
          scannedCode: match.serial
        });
      } else {
        // Buscar opciones parecidas en SANTI (por ceros finales, subcadenas o similitud)
        const candidates = findSimilarCandidates(code, allSystemPrinters);
        if (candidates.length > 0) {
          soundEffects.playScanSuccess();
          setSimilarCandidates(candidates);
          setScannedSimilarCode(candidateSerial || code);
          setIsSimilarModalOpen(true);
        } else {
          soundEffects.playScanError();
          setNotFoundSerial(candidateSerial || code);
        }
      }
    }
    setScanInput('');
  };

  // Seleccionar candidato similar desde el modal de opciones parecidas en SANTI
  const handleSelectSimilarCandidate = (selectedItem) => {
    setIsSimilarModalOpen(false);
    if (!selectedItem) return;

    if (activeChecklist) {
      soundEffects.playScanSuccess();
      setSuccessMessage(`✓ ¡SÍ ESTÁ! [${selectedItem.material || 'EQUIPO'}] Serie: ${selectedItem.serial}`);
      if (onCompleteTrailer) {
        onCompleteTrailer(selectedItem.serial, null, activeChecklist.id);
      }
    } else {
      soundEffects.playScanSuccess();
      handleSelectPrinter({
        ...selectedItem,
        scannedCode: selectedItem.serial
      });
    }
  };

  // Escáner de pistola física global
  useBarcodeScanner((scanned) => {
    if (!isCameraActive && !activePrinter && !isSimilarModalOpen) {
      handleProcessScan(scanned);
    }
  });

  // Confirmar y guardar asignación física
  const handleSaveLocation = async (e) => {
    if (e) e.preventDefault();
    if (!activePrinter) return;

    // Si el espacio ya está ocupado, abrir el modal de resolución (Opción 2)
    if (collisionOccupant) {
      soundEffects.playScanDuplicate();
      setIsCollisionModalOpen(true);
      return;
    }

    await executeDirectSave();
  };

  const executeDirectSave = async () => {
    if (!activePrinter) return;
    setIsSubmitting(true);
    try {
      const spaceVal = spaceInput.trim() || 'General';
      const numEquipo = internalNumberInput.trim() !== '' ? internalNumberInput.trim() : activePrinter.internalNumber;

      // 1. Asignar en inventario
      await InventoryController.assignPrinter(activePrinter.serial, {
        warehouseName: selectedWarehouse,
        warehouseRow: selectedRow,
        warehouseSpace: spaceVal,
        internalNumber: numEquipo
      });

      // 2. Si venía de un checklist activo, registrar escaneo en el lote
      if (activeChecklist && onCompleteTrailer) {
        await onCompleteTrailer(activePrinter.serial, {
          warehouseName: selectedWarehouse,
          warehouseRow: selectedRow,
          warehouseSpace: spaceVal,
          internalNumber: numEquipo,
          batchId: activeChecklist.id
        }, activeChecklist.id);
      }

      // 3. Asegurar que la fila y el almacén existan en el plano del mapa
      if (selectedRow) {
        WarehouseMapController.ensureRowExists(selectedRow, selectedWarehouse);
      }

      soundEffects.playLocationAssigned();
      setSuccessMessage(`✓ [${activePrinter.material || 'MÁQUINA'}] Serie ${activePrinter.serial} guardada en ${selectedWarehouse} → ${selectedRow} [${spaceVal}]`);

      // Calcular siguiente espacio consecutivo y actualizar la secuencia activa
      const nextConsecutiveSpace = getNextSpace(spaceVal);
      setOperatorSequence({
        warehouse: selectedWarehouse,
        row: selectedRow,
        space: nextConsecutiveSpace
      });
      setSpaceInput(nextConsecutiveSpace);

      setActivePrinter(null);
      if (onAssignmentSaved) onAssignmentSaved();

      // Devolver foco al input
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 150);
    } catch (err) {
      alert("Error guardando ubicación: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Resolución de colisiones de espacio (Opción 2: Reemplazar, Intercambiar o Compartir)
  const handleResolveCollision = async (action) => {
    if (!activePrinter || !collisionOccupant) return;
    setIsSubmitting(true);
    try {
      const spaceVal = spaceInput.trim() || 'General';
      const numEquipo = internalNumberInput.trim() !== '' ? internalNumberInput.trim() : activePrinter.internalNumber;

      if (action === 'REPLACE') {
        // 1. Desalojar al equipo anterior (pasa a pendiente de ubicación)
        await InventoryController.unassignPrinter(collisionOccupant.serial);
        // 2. Asignar el equipo actual
        await InventoryController.assignPrinter(activePrinter.serial, {
          warehouseName: selectedWarehouse,
          warehouseRow: selectedRow,
          warehouseSpace: spaceVal,
          internalNumber: numEquipo
        });
        setSuccessMessage(`✓ Serie ${activePrinter.serial} colocada en ${selectedRow} [${spaceVal}]. La serie ${collisionOccupant.serial} pasó a Pendiente.`);
      } else if (action === 'SWAP') {
        // Intercambiar posiciones entre ambos equipos
        await InventoryController.swapPrinters(activePrinter, collisionOccupant);
        setSuccessMessage(`✓ Serie ${activePrinter.serial} colocada en ${selectedRow} [${spaceVal}]. Se intercambió lugar con ${collisionOccupant.serial}.`);
      } else if (action === 'SHARE') {
        // Compartir espacio: ambas máquinas se guardan juntas
        await InventoryController.assignPrinter(activePrinter.serial, {
          warehouseName: selectedWarehouse,
          warehouseRow: selectedRow,
          warehouseSpace: spaceVal,
          internalNumber: numEquipo
        });
        setSuccessMessage(`✓ Serie ${activePrinter.serial} colocada en ${selectedRow} [${spaceVal}] (Compartiendo con ${collisionOccupant.serial}).`);
      }

      // Si venía de checklist activo
      if (activeChecklist && onCompleteTrailer) {
        await onCompleteTrailer(activePrinter.serial, {
          warehouseName: selectedWarehouse,
          warehouseRow: selectedRow,
          warehouseSpace: spaceVal,
          internalNumber: numEquipo,
          batchId: activeChecklist.id
        }, activeChecklist.id);
      }

      if (selectedRow) {
        WarehouseMapController.ensureRowExists(selectedRow, selectedWarehouse);
      }

      soundEffects.playLocationAssigned();

      // Siguiente espacio consecutivo
      const nextConsecutiveSpace = getNextSpace(spaceVal);
      setOperatorSequence({
        warehouse: selectedWarehouse,
        row: selectedRow,
        space: nextConsecutiveSpace
      });
      setSpaceInput(nextConsecutiveSpace);

      setIsCollisionModalOpen(false);
      setActivePrinter(null);
      if (onAssignmentSaved) onAssignmentSaved();

      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 150);
    } catch (err) {
      alert("Error resolviendo conflicto de espacio: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtrado de equipos pendientes
  const filteredUnassigned = useMemo(() => {
    if (!searchTableQuery.trim()) return unassignedPrinters;
    const q = searchTableQuery.toLowerCase();
    return unassignedPrinters.filter(p => 
      (p.serial && p.serial.toLowerCase().includes(q)) ||
      (p.material && p.material.toLowerCase().includes(q))
    );
  }, [unassignedPrinters, searchTableQuery]);

  // Si hay un lote de Mercado Libre seleccionado para escaneo
  if (activeMlBatch) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none max-w-lg mx-auto pb-10">
        <header className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between sticky top-0 z-40">
          <button
            onClick={() => setActiveMlBatchId(null)}
            className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1.5 py-1.5 px-3 bg-slate-800/90 rounded-xl border border-slate-700 active:scale-95"
          >
            <span>&larr; Volver a Despachos ML</span>
          </button>
          <div className="text-right">
            <span className="bg-amber-600 text-white font-black text-[10px] px-2 py-0.5 rounded uppercase">
              {activeMlBatch.folio}
            </span>
          </div>
        </header>
      <OfflineSyncBanner className="mx-3 mt-2.5" />
        <div className="flex-1">
          <MercadoLibreScanView
            batchDetails={activeMlBatch}
            onRecordScan={(batchId, itemId, method) => {
              if (onRecordMlScan) onRecordMlScan(batchId, itemId, method);
            }}
            onRecordUnexpected={(batchId, code) => {
              if (onRecordMlUnexpected) onRecordMlUnexpected(batchId, code);
            }}
            onFinishSession={() => {
              setActiveMlBatchId(null);
              if (onRefreshMl) onRefreshMl();
            }}
            onForceFinish={() => {
              if (onForceFinishMlBatch) onForceFinishMlBatch();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none max-w-lg mx-auto pb-10">
      
      {/* BARRA SUPERIOR MÓVIL DEL OPERADOR */}
      <header className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-600 text-white font-black text-sm flex items-center justify-center">
            CDM
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide leading-none">MODO OPERADOR</h1>
            {!isOnline ? (
              <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Modo Offline (Sin Wi-Fi)
              </span>
            ) : pendingCount > 0 ? (
              <button
                type="button"
                onClick={syncNow}
                disabled={isSyncing}
                className="text-[10px] text-amber-300 font-bold flex items-center gap-1 mt-0.5 hover:underline"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                {isSyncing ? 'Subiendo datos...' : `${pendingCount} pendientes (Subir)`}
              </button>
            ) : (
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                En Línea (Tiempo Real)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón de recargar datos */}
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              className="p-1.5 px-2.5 rounded-xl border bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs font-bold transition active:scale-95 flex items-center gap-1"
              title="Actualizar checklists e inventario"
            >
              <span className={isLoading ? 'animate-spin inline-block' : ''}>🔄</span>
            </button>
          )}

          {/* Botón de alternar audio */}
          <button
            type="button"
            onClick={() => setSoundMuted(toggleSoundMute())}
            className={`p-1.5 px-2 rounded-xl border text-xs font-bold transition flex items-center gap-1 ${
              soundMuted
                ? 'bg-slate-800 text-slate-500 border-slate-700'
                : 'bg-emerald-950 text-emerald-400 border-emerald-700/80 shadow-2xs'
            }`}
            title={soundMuted ? 'Sonidos silenciados (clic para activar)' : 'Sonidos activos (clic para silenciar)'}
          >
            <span>{soundMuted ? '🔇' : '🔊'}</span>
          </button>

          {/* Botón para regresar a modo oficina (con contraseña) */}
          <button
            type="button"
            onClick={onRequestAdminView}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
            title="Acceso protegido a pantalla de oficina / computadora"
          >
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Oficina</span>
          </button>
        </div>
      </header>

      <OfflineSyncBanner className="mx-3 mt-2.5" />

      {/* MENSAJE DE ÉXITO O ALERTA */}
      {successMessage && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold text-center animate-fade-in flex items-center justify-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
          <span>{successMessage}</span>
        </div>
      )}

      {notFoundSerial && (
        <div className="bg-rose-600 text-white px-4 py-2 text-xs font-bold animate-fade-in flex flex-wrap items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-1.5 truncate">
            <span>⚠️</span>
            <span className="truncate">Serie "{notFoundSerial}" no encontrada exactamente.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const targetList = activeChecklist ? activeChecklist.expectedSeries : allSystemPrinters;
              const cands = findSimilarCandidates(notFoundSerial, targetList);
              if (cands.length > 0) {
                setSimilarCandidates(cands);
                setScannedSimilarCode(notFoundSerial);
                setIsSimilarModalOpen(true);
              } else {
                alert(`No se encontraron series parecidas a "${notFoundSerial}" en SANTI.`);
              }
            }}
            className="text-[11px] bg-slate-950/80 hover:bg-slate-950 text-amber-300 font-bold px-3 py-1 rounded-xl border border-amber-400/50 shrink-0 transition active:scale-95 flex items-center gap-1"
          >
            🔍 <span>Ver Opciones Parecidas</span>
          </button>
        </div>
      )}

      {/* SELECTOR DE MODO: 4 PESTAÑAS (LECTURA, CHECKLISTS, MERCADO LIBRE, BAJAS) */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800">
        <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-2xl border border-slate-800">
          <button
            onClick={() => {
              setOperatorTab('reading');
              setActiveChecklistId(null);
              setActiveMlBatchId(null);
            }}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 ${
              operatorTab === 'reading' && !activeChecklistId
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Lectura</span>
          </button>

          <button
            onClick={() => {
              setOperatorTab('checklists');
              setActiveMlBatchId(null);
            }}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 ${
              (operatorTab === 'checklists' || activeChecklistId) && operatorTab !== 'bajas'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Lotes ({receptionBatches.length})</span>
          </button>

          <button
            onClick={() => {
              setOperatorTab('mercadolibre');
              setActiveChecklistId(null);
            }}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 ${
              operatorTab === 'mercadolibre'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-amber-400">📦</span>
            <span>ML</span>
          </button>

          <button
            onClick={() => {
              setOperatorTab('bajas');
              setActiveChecklistId(null);
              setActiveMlBatchId(null);
            }}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex items-center justify-center gap-1 ${
              operatorTab === 'bajas'
                ? 'bg-rose-700 text-white shadow-md'
                : 'text-rose-400 hover:text-white'
            }`}
          >
            <span>🔴</span>
            <span>Bajas</span>
          </button>
        </div>
      </div>

      {/* ÁREA DE CAPTURA PRINCIPAL */}
      <div className="p-4 flex-1 flex flex-col gap-4">

        {/* SI ESTÁ EN MODO BAJAS */}
        {operatorTab === 'bajas' && (
          <div className="bg-slate-900 rounded-2xl">
            <BajasSessionView
              batches={batches}
              allPrinters={placedPrinters}
              allSystemPrinters={allSystemPrinters}
              onBajasCommitted={async () => {
                if (onRefreshData) await onRefreshData();
              }}
            />
          </div>
        )}

        {/* SI ESTÁ VIENDO LA LISTA DE CHECKLISTS */}
        {operatorTab === 'checklists' && !activeChecklistId && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-slate-200">Selecciona el Checklist a Recibir:</h2>
            {receptionBatches.length === 0 ? (
              <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 text-center">
                <p className="text-xs text-slate-400">No hay checklists de recepción de equipos nuevos pendientes.</p>
              </div>
            ) : (
              receptionBatches.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => setActiveChecklistId(batch.id)}
                  className="bg-slate-800 hover:bg-slate-700/80 p-4 rounded-2xl border border-slate-700 text-left transition flex items-center justify-between active:scale-98"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-red-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-lg">
                        {batch.folio}
                      </span>
                      <span className="text-xs font-bold text-white">{batch.cleanName || batch.name}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {batch.completed.length} de {batch.totalCount} escaneados
                    </span>
                  </div>
                  <span className="text-red-400 text-sm font-bold">&rarr;</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* SI ESTÁ VIENDO LA LISTA DE MERCADO LIBRE */}
        {operatorTab === 'mercadolibre' && (
          <div className="flex flex-col gap-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                  <span>Despachos Mercado Libre ({mlBatches.length}):</span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Selecciona un despacho para iniciar la lectura</p>
              </div>
              {onRefreshMl && (
                <button
                  type="button"
                  onClick={onRefreshMl}
                  className="text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-xl border border-slate-700 flex items-center gap-1 active:scale-95"
                  title="Actualizar despachos de Mercado Libre"
                >
                  <span>🔄 Refrescar</span>
                </button>
              )}
            </div>

            {mlBatches.length === 0 ? (
              <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 text-center">
                <p className="text-xs text-slate-300 font-semibold">No hay despachos de Mercado Libre cargados.</p>
                <p className="text-[11px] text-slate-400 mt-1">Sube el archivo Excel en la vista de Oficina para que aparezca aquí para escaneo.</p>
              </div>
            ) : (
              mlBatches.map(batch => {
                const totalItems = batch.totalCount || batch.items.length;
                const scannedItems = batch.scannedCount || batch.items.filter(i => i.isScanned).length;
                const isComplete = batch.status === 'completed' || (totalItems > 0 && scannedItems >= totalItems);

                return (
                  <button
                    key={batch.id}
                    onClick={() => setActiveMlBatchId(batch.id)}
                    className="bg-slate-800 hover:bg-slate-700/80 p-4 rounded-2xl border border-slate-700 text-left transition flex items-center justify-between active:scale-98"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-amber-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-lg">
                          {batch.folio}
                        </span>
                        <span className="text-xs font-bold text-white truncate max-w-[180px]">
                          {batch.cleanName || batch.name}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {scannedItems} de {totalItems} paquetes escaneados
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        isComplete 
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        {isComplete ? 'Listo' : 'Pendiente'}
                      </span>
                      <span className="text-amber-400 text-sm font-bold">&rarr;</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* SI TIENE UN CHECKLIST ACTIVO O ESTÁ EN LECTURA DIRECTA */}
        {(operatorTab === 'reading' || (operatorTab === 'checklists' && activeChecklistId)) && (
          <div className="flex flex-col gap-4">
            
            {/* ENCABEZADO DE MODO ACTIVO */}
            {activeChecklist && (
              <div className="bg-red-950/70 border border-red-700/60 p-3 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-red-300 uppercase tracking-wide">Checklist Activo:</span>
                  <p className="text-xs font-black text-white">{activeChecklist.folio} - {activeChecklist.cleanName}</p>
                  <p className="text-[10px] text-emerald-400 font-bold mt-0.5">
                    {activeChecklist.completed.length} de {activeChecklist.totalCount} completados
                  </p>
                </div>
                <button
                  onClick={() => setActiveChecklistId(null)}
                  className="text-[11px] text-slate-300 bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700 font-medium"
                >
                  Cambiar
                </button>
              </div>
            )}

            {/* BARRA DE SECUENCIA Y UBICACIÓN CONSECUTIVA ACTIVA */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-3 flex flex-col gap-2 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Ubicación Activa Consecutiva:
                </span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">
                  {operatorSequence.space ? `Próximo: ${operatorSequence.space}` : 'Próximo: manual'}
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/80 p-2 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-1.5 font-bold truncate">
                  <span className="text-white bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700 truncate max-w-[110px]">
                    {operatorSequence.warehouse || selectedWarehouse}
                  </span>
                  <span className="text-slate-500">→</span>
                  <span className="text-emerald-300 bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700 truncate max-w-[90px]">
                    {operatorSequence.row || selectedRow}
                  </span>
                  {operatorSequence.space && (
                    <>
                      <span className="text-slate-500">→</span>
                      <span className="text-amber-400 font-mono font-bold bg-amber-950/60 px-2 py-0.5 rounded-lg border border-amber-800/50">
                        {operatorSequence.space}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const newWh = prompt('Nombre del nuevo almacén:', '');
                      if (newWh) handleAddNewWarehouse(newWh);
                    }}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-blue-300 font-bold px-2 py-1 rounded-lg border border-slate-700 transition"
                  >
                    + Almacén
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newRow = prompt(`Nombre de la nueva fila para "${operatorSequence.warehouse || selectedWarehouse}":`, '');
                      if (newRow) handleAddNewRow(newRow);
                    }}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold px-2 py-1 rounded-lg border border-slate-700 transition"
                  >
                    + Fila
                  </button>
                </div>
              </div>
            </div>

            {/* BARRA DE ENTRADA CON PISTOLA O TECLADO */}
            <div className="bg-slate-800/80 p-4 rounded-3xl border border-slate-700 flex flex-col gap-3 shadow-lg">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wide flex items-center justify-between">
                <span>Disparar Pistola / Escanear Serie:</span>
                <span className="text-[10px] text-emerald-400 font-normal">Listo para lectura</span>
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  ref={scanInputRef}
                  placeholder="ESCANEAR O ESCRIBIR SERIE..."
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleProcessScan(scanInput);
                    }
                  }}
                  className="flex-1 bg-slate-950 border-2 border-slate-600 focus:border-emerald-500 rounded-2xl px-4 py-3 text-sm font-mono font-bold text-white uppercase outline-none placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={() => handleProcessScan(scanInput)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 rounded-2xl text-xs transition active:scale-95"
                >
                  OK
                </button>
              </div>

              {/* BOTÓN GRANDE PARA ABRIR CÁMARA DEL CELULAR */}
              <button
                type="button"
                onClick={() => setIsCameraActive(!isCameraActive)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 text-xs transition border border-slate-600 shadow-sm active:scale-98"
              >
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{isCameraActive ? 'Cerrar Cámara' : 'Abrir Cámara con Linterna y Zoom'}</span>
              </button>
            </div>

            {/* VISOR DE CÁMARA */}
            {isCameraActive && (
              <div className="bg-slate-950 p-2 rounded-3xl border border-slate-700 overflow-hidden">
                <CameraScanner
                  onScan={(code) => {
                    setIsCameraActive(false);
                    handleProcessScan(code);
                  }}
                  onCancel={() => setIsCameraActive(false)}
                />
              </div>
            )}

            {/* LISTA RÁPIDA DE EQUIPOS PENDIENTES DE UBICACIÓN O SERIES DEL CHECKLIST */}
            {!activeChecklist ? (
              <div className="bg-slate-800/60 rounded-3xl p-4 border border-slate-700/80 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Pendientes de Ubicación ({unassignedPrinters.length})
                    </h3>
                    <p className="text-[10px] text-slate-400">Toca cualquier equipo para asignarlo</p>
                  </div>
                  <div className="w-36">
                    <input
                      type="text"
                      placeholder="Filtrar..."
                      value={searchTableQuery}
                      onChange={(e) => setSearchTableQuery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-white placeholder-slate-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredUnassigned.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No hay equipos pendientes con ese filtro.</p>
                  ) : (
                    filteredUnassigned.slice(0, 30).map((printer) => (
                      <div
                        key={printer.id || printer.serial}
                        onClick={() => handleSelectPrinter(printer)}
                        className="bg-slate-900 hover:bg-slate-750 p-3 rounded-2xl border border-slate-700/80 flex items-center justify-between cursor-pointer active:scale-98 transition"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white text-xs">{printer.serial}</span>
                            {printer.internalNumber && (
                              <span className="bg-slate-800 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                #{printer.internalNumber}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block mt-0.5">{printer.material}</span>
                        </div>
                        <span className="text-emerald-400 text-xs font-bold bg-emerald-950/80 px-2.5 py-1 rounded-xl border border-emerald-800">
                          Ubicar &rarr;
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-800/60 rounded-3xl p-4 border border-slate-700/80 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Series del Checklist ({activeChecklist.completed.length} / {activeChecklist.expectedSeries.length})
                    </h3>
                    <p className="text-[10px] text-slate-400">Escaneo rápido: solo marca si está o no está</p>
                  </div>
                  <span className="text-[10px] bg-slate-900/90 text-slate-300 font-bold px-2 py-0.5 rounded-full border border-slate-700 self-start sm:self-auto">
                    {filteredChecklistSeries.length} mostradas
                  </span>
                </div>

                {/* Filtro de Estado para Operador Móvil: Todas / Faltan / Leídas */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setChecklistStatusFilter('ALL')}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition flex items-center gap-1 shrink-0 ${
                      checklistStatusFilter === 'ALL'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-700/60'
                    }`}
                  >
                    <span>Todas</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded-full font-bold ${checklistStatusFilter === 'ALL' ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-slate-400'}`}>
                      {activeChecklist.expectedSeries.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setChecklistStatusFilter('PENDING')}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition flex items-center gap-1 shrink-0 ${
                      checklistStatusFilter === 'PENDING'
                        ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 border border-amber-800/60'
                    }`}
                  >
                    <span>⏳ Faltan</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded-full font-bold ${checklistStatusFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'bg-amber-900/80 text-amber-200'}`}>
                      {activeChecklist.expectedSeries.length - activeChecklist.completed.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setChecklistStatusFilter('SCANNED')}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition flex items-center gap-1 shrink-0 ${
                      checklistStatusFilter === 'SCANNED'
                        ? 'bg-emerald-500 text-slate-950 font-black shadow-xs'
                        : 'bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-800/60'
                    }`}
                  >
                    <span>✓ Leídas</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded-full font-bold ${checklistStatusFilter === 'SCANNED' ? 'bg-emerald-600 text-white' : 'bg-emerald-900/80 text-emerald-200'}`}>
                      {activeChecklist.completed.length}
                    </span>
                  </button>
                </div>

                {/* Botón de Coincidencias en Móvil */}
                {activeChecklistMissing.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSimilarityModal(true)}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 px-3.5 rounded-2xl text-xs transition shadow-sm flex items-center justify-center gap-2 active:scale-98"
                  >
                    <span>🔍 Buscar Coincidencias (Faltantes vs Errores)</span>
                    {activeChecklistSimilarMatches.length > 0 && (
                      <span className="bg-slate-950 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full">
                        {activeChecklistSimilarMatches.length}
                      </span>
                    )}
                  </button>
                )}

                {/* Filtro por Documentos si hay más de 1 documento */}
                {checklistDistinctDocs.length > 1 && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-700/60">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Separación por Documento ({checklistDistinctDocs.length}):
                    </span>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setChecklistDocFilter('ALL')}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition shrink-0 ${
                          checklistDocFilter === 'ALL'
                            ? 'bg-red-600 text-white font-bold'
                            : 'bg-slate-900/90 text-slate-400 hover:text-white border border-slate-700'
                        }`}
                      >
                        Todos
                      </button>
                      {checklistDistinctDocs.map((doc, idx) => {
                        const stats = checklistDocStats[doc] || { total: 0, scanned: 0 };
                        const isSel = checklistDocFilter === doc;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setChecklistDocFilter(doc)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition flex items-center gap-1 shrink-0 ${
                              isSel
                                ? 'bg-red-600 text-white font-bold'
                                : 'bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700'
                            }`}
                          >
                            <span className="truncate max-w-[110px]">📄 {doc}</span>
                            <span className={`text-[9px] px-1 rounded ${isSel ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-400'}`}>
                              {stats.scanned}/{stats.total}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Listado de series con separadores por documento */}
                <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1 mt-1">
                  {filteredChecklistSeries.length === 0 ? (
                    <div className="text-center py-6 bg-slate-900/40 rounded-2xl border border-dashed border-slate-700">
                      <p className="text-xs text-slate-400 font-medium">No hay series con este filtro.</p>
                    </div>
                  ) : (
                    Object.entries(groupedChecklistSeries).map(([docName, items]) => {
                      const showHeader = checklistDistinctDocs.length > 1 && checklistDocFilter === 'ALL';
                      const stats = checklistDocStats[docName] || { total: items.length, scanned: 0, pending: items.length };
                      return (
                        <div key={docName} className="flex flex-col gap-1.5">
                          {showHeader && (
                            <div className="bg-slate-900/90 px-2.5 py-1 rounded-xl border border-slate-700 flex items-center justify-between sticky top-0 backdrop-blur-sm z-10">
                              <span className="text-[11px] font-bold text-slate-300 truncate max-w-[180px]">
                                📄 {docName}
                              </span>
                              <div className="flex items-center gap-1.5 text-[9px] font-bold">
                                <span className="text-emerald-400">✓ {stats.scanned}</span>
                                <span className="text-amber-400">⏳ {stats.pending}</span>
                              </div>
                            </div>
                          )}

                          {items.map((item, idx) => {
                            const isPresent = activeChecklist.completed.includes(item.serial);
                            return (
                              <div
                                key={idx}
                                className={`p-3 rounded-2xl border flex items-center justify-between ${
                                  isPresent
                                    ? 'bg-emerald-950/50 border-emerald-700/80'
                                    : 'bg-slate-900 border-slate-700/80'
                                }`}
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-white text-xs block">{item.serial}</span>
                                    {item.documentName && checklistDistinctDocs.length > 1 && checklistDocFilter !== 'ALL' && (
                                      <span className="text-[9px] bg-slate-800 text-slate-400 px-1 py-0.2 rounded truncate max-w-[100px]">
                                        📄 {item.documentName}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-slate-400 block mt-0.5 truncate">{item.material || 'SIN MODELO'}</span>
                                </div>
                                  {isPresent ? (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-xl border shrink-0 bg-emerald-600 text-white border-emerald-500">
                                      ✓ SÍ ESTÁ
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleProcessScan(item.serial)}
                                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-xl border shrink-0 bg-slate-800 hover:bg-emerald-700 text-slate-300 hover:text-white border-slate-600 active:scale-95 transition"
                                    >
                                      Marcar ✓
                                    </button>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* MODAL DE COINCIDENCIAS EN MÓVIL */}
      {activeChecklist && (
        <SerialSimilarityModal
          isOpen={showSimilarityModal}
          onClose={() => setShowSimilarityModal(false)}
          batchDetails={activeChecklist}
          onAcceptMatch={async (match) => {
            if (onReconcileSimilar) {
              soundEffects.playScanSuccess();
              await onReconcileSimilar(match, activeChecklist.id);
              setSuccessMessage(`✓ Serie corregida y verificada: ${match.scannedSerial}`);
            }
          }}
          onAcceptAll={async (matchesList) => {
            if (onReconcileSimilar && matchesList?.length) {
              soundEffects.playScanSuccess();
              for (const m of matchesList) {
                await onReconcileSimilar(m, activeChecklist.id);
              }
              setSuccessMessage(`✓ ${matchesList.length} coincidencias corregidas y verificadas.`);
            }
          }}
        />
      )}

      {/* VENTANA MODAL MÓVIL: ¿DÓNDE LA QUIERES COLOCAR? */}
      {activePrinter && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-slate-900 text-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 border border-slate-700 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
            
            {/* CABECERA DEL MODAL */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  Equipo Detectado
                </span>
                <h3 className="text-lg font-black text-white mt-1">¿Dónde la quieres colocar?</h3>
              </div>
              <button
                onClick={() => setActivePrinter(null)}
                className="text-slate-400 hover:text-white p-1 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* DETALLES DESTACADOS: MODELO DE IMPRESORA Y SERIE */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col gap-2.5 shadow-inner">
              <div className="bg-slate-900/90 border border-emerald-500/30 p-3.5 rounded-xl flex items-center justify-between">
                <div className="flex-1 mr-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    MODELO DE LA MÁQUINA
                  </span>
                  <span className="text-base sm:text-lg font-black text-white block mt-0.5 tracking-tight break-words">
                    {activePrinter.material || 'MODELO GENÉRICO'}
                  </span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </div>
              </div>

              <div className="flex flex-wrap justify-between items-center px-1 text-xs gap-2 pt-1 border-t border-slate-800/80">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Serie en Excel:</span>
                  <span className="font-mono font-black text-emerald-400 text-sm tracking-wide">{activePrinter.serial}</span>
                </div>
                {activePrinter.scannedCode && activePrinter.scannedCode !== activePrinter.serial && (
                  <div className="text-right">
                    <span className="text-[10px] text-amber-400 font-bold uppercase block">Leído por Pistola:</span>
                    <span className="font-mono text-slate-200 text-xs bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                      {activePrinter.scannedCode}
                    </span>
                  </div>
                )}
                {activePrinter.internalNumber && (
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">No. Equipo:</span>
                    <span className="font-bold text-amber-400 text-xs">#{activePrinter.internalNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* FORMULARIO TÁCTIL */}
            <form onSubmit={handleSaveLocation} className="space-y-3.5">
              
              {/* ALMACÉN */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-bold text-slate-300 uppercase">Almacén:</label>
                  {!showCustomWarehouse ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(true)}
                      className="text-[11px] text-blue-400 hover:underline font-bold"
                    >
                      + Nuevo Almacén
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(false)}
                      className="text-[11px] text-slate-400"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {!showCustomWarehouse ? (
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => handleWarehouseChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                  >
                    {warehouseOptions.map((w, idx) => (
                      <option key={idx} value={w}>{w}</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Ej: Alpha, Beta..."
                      value={customWarehouseInput}
                      onChange={(e) => setCustomWarehouseInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddNewWarehouse(customWarehouseInput);
                        }
                      }}
                      className="flex-1 bg-slate-950 border border-blue-400 rounded-xl px-3 py-2 text-xs font-bold text-white uppercase outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddNewWarehouse(customWarehouseInput)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* FILA CON STEPPER [-] [ INPUT ] [+] */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-bold text-slate-300 uppercase">Fila:</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">Sube/baja con [-] [+] o edita</span>
                    {!showCustomRow ? (
                      <button
                        type="button"
                        onClick={() => setShowCustomRow(true)}
                        className="text-[11px] text-blue-400 hover:underline font-bold"
                      >
                        Lista
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowCustomRow(false)}
                        className="text-[11px] text-slate-400"
                      >
                        Stepper
                      </button>
                    )}
                  </div>
                </div>

                {!showCustomRow ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStepRow(-1)}
                      className="w-12 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded-xl text-white font-black text-2xl flex items-center justify-center transition active:scale-95 shadow-sm"
                      title="Fila anterior (-1)"
                    >
                      −
                    </button>

                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={selectedRow}
                        onChange={(e) => handleRowChange(e.target.value)}
                        list="operator-row-suggestions"
                        placeholder="Ej: Fila 1"
                        className="w-full h-12 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 text-center text-sm font-black text-white uppercase outline-none"
                      />
                      <datalist id="operator-row-suggestions">
                        {rowOptions.map((r, idx) => (
                          <option key={idx} value={r} />
                        ))}
                      </datalist>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStepRow(1)}
                      className="w-12 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded-xl text-white font-black text-2xl flex items-center justify-center transition active:scale-95 shadow-sm"
                      title="Siguiente fila (+1)"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <select
                    value={selectedRow}
                    onChange={(e) => {
                      handleRowChange(e.target.value);
                      setShowCustomRow(false);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                  >
                    {rowOptions.map((r, idx) => (
                      <option key={idx} value={r}>{r}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* ESPACIO EN LA FILA CON STEPPER [-] [ INPUT ] [+] */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-bold text-slate-300 uppercase">
                    Espacio en la Fila:
                  </label>
                  <span className="text-[10px] text-emerald-400 font-bold">Consecutivo Automático</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStepSpace(-1)}
                    className="w-12 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-emerald-700/60 rounded-xl text-emerald-400 font-black text-2xl flex items-center justify-center transition active:scale-95 shadow-sm"
                    title="Espacio anterior (-1)"
                  >
                    −
                  </button>

                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="EJ: 19 D, 3 I, 14 D..."
                    value={spaceInput}
                    onChange={(e) => handleSpaceChange(e.target.value)}
                    className="flex-1 h-12 bg-slate-950 border-2 border-emerald-500 rounded-xl px-3 text-center text-lg font-black text-white uppercase tracking-wider outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => handleStepSpace(1)}
                    className="w-12 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-emerald-700/60 rounded-xl text-emerald-400 font-black text-2xl flex items-center justify-center transition active:scale-95 shadow-sm"
                    title="Siguiente espacio (+1)"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 text-center">
                  Usa [-] y [+] para avanzar consecutivo o escribe directamente (ej: 19 D, 3 I, 14)
                </p>
              </div>

              {/* NÚMERO DE EQUIPO OPCIONAL */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1 uppercase">
                  Número de Equipo (opcional si es nuevo):
                </label>
                <input
                  type="text"
                  placeholder="Ej: 2535 (o en blanco)"
                  value={internalNumberInput}
                  onChange={(e) => setInternalNumberInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none"
                />
              </div>

              {/* ALERTA DE COLISIÓN DE ESPACIO EN TIEMPO REAL */}
              {collisionOccupant && (
                <div className="bg-amber-950/70 border-2 border-amber-500 rounded-2xl p-3 text-xs text-amber-200">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚠️</span>
                    <p className="font-bold text-amber-300 text-sm">Espacio Actualmente Ocupado</p>
                  </div>
                  <p className="mt-1">
                    El espacio <strong className="underline text-white">"{spaceInput}"</strong> en <strong className="text-white">{selectedRow}</strong> ({selectedWarehouse}) ya está asignado a:
                  </p>
                  <div className="bg-slate-900/90 rounded-lg p-2 mt-1.5 border border-amber-600/40">
                    <p className="font-mono font-bold text-white text-xs">{collisionOccupant.serial}</p>
                    <p className="text-[11px] text-slate-300">{collisionOccupant.model || 'Sin modelo'}</p>
                  </div>
                  <p className="mt-1.5 text-[11px] text-amber-300 font-semibold">
                    💡 Al presionar el botón podrás <strong>Reemplazarlo</strong>, <strong>Intercambiarlo</strong> o <strong>Compartir la tarima</strong>.
                  </p>
                </div>
              )}

              {/* BOTÓN GRANDE PARA CONFIRMAR */}
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wide transition shadow-lg flex items-center justify-center gap-2 mt-2 ${
                  collisionOccupant
                    ? 'bg-amber-600 hover:bg-amber-500 text-white active:scale-98'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-98'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>
                  {isSubmitting
                    ? 'Guardando...'
                    : collisionOccupant
                    ? '⚠️ Resolver Espacio Ocupado'
                    : 'Confirmar y Colocar Equipo'}
                </span>
              </button>
            </form>

          </div>
        </div>
      )}

      {/* MODAL DE OPCIONES PARECIDAS EN SANTI */}
      <SimilarPrintersModal
        isOpen={isSimilarModalOpen}
        onClose={() => setIsSimilarModalOpen(false)}
        scannedCode={scannedSimilarCode}
        candidates={similarCandidates}
        onSelectCandidate={handleSelectSimilarCandidate}
      />

      {/* MODAL DE RESOLUCIÓN DE COLISIÓN DE ESPACIO (OPCIÓN 2) */}
      <SpaceCollisionModal
        isOpen={isCollisionModalOpen}
        onClose={() => setIsCollisionModalOpen(false)}
        targetLocation={{
          warehouse: selectedWarehouse,
          row: selectedRow,
          space: spaceInput,
        }}
        currentOccupant={collisionOccupant}
        incomingPrinter={activePrinter}
        onResolve={handleResolveCollision}
        isSubmitting={isSubmitting}
      />

    </div>
  );
}
