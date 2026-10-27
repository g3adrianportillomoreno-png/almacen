import { useState, useRef, useMemo } from 'react';
import { extractSeriesFromExcel } from '../utils/excelParser';
import { InventoryController } from '../controllers/InventoryController.js';
import { ChecklistController } from '../controllers/ChecklistController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import WarehouseMapView from './WarehouseMapView.jsx';
import WarehouseAssignmentView from './WarehouseAssignmentView.jsx';

export default function HomeView({ 
  batches = [], 
  onCreateBatch, 
  onSelectBatch, 
  onDeleteBatch,
  onNavigateToModelSearch,
  onNavigateToAssignment,
  onNavigateToMasterInventory,
  onNavigateToReading,
  onNavigateToBajas,
  onStatusChange,
  onLayoutChange
}) {
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingProgress, setProcessingProgress] = useState('');

  // Modal para que el operador coloque obligatoriamente el consecutivo manual y contraseña de autorización
  const [pendingUploadData, setPendingUploadData] = useState(null);
  const [manualConsecutiveInput, setManualConsecutiveInput] = useState('');
  const [uploadPasswordInput, setUploadPasswordInput] = useState('');
  const [uploadSaveMode, setUploadSaveMode] = useState('NEW'); // 'NEW' | 'MERGE_EXISTING'
  const [uploadMergeTargetId, setUploadMergeTargetId] = useState('');
  const [uploadMergeListMode, setUploadMergeListMode] = useState('UNION'); // 'UNION' | 'BASE_LIST'

  // Estados de la Vista Previa Editable de Series antes de guardar el Checklist
  const [showSeriesPreview, setShowSeriesPreview] = useState(false);
  const [previewFilterMode, setPreviewFilterMode] = useState('ALL'); // 'ALL' | 'REPAIRED'
  const [previewSearch, setPreviewSearch] = useState('');
  const [newManualSerial, setNewManualSerial] = useState('');
  const [newManualMaterial, setNewManualMaterial] = useState('');

  // Modal para Fusionar Checklists existentes y cruzar correspondencias automáticamente
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedMergeBatchIds, setSelectedMergeBatchIds] = useState([]);
  const [mergeTargetBatchId, setMergeTargetBatchId] = useState('');
  const [mergeMode, setMergeMode] = useState('UNION'); // 'UNION' | 'BASE_LIST'
  const [mergeBaseListBatchId, setMergeBaseListBatchId] = useState('');
  const [mergePasswordInput, setMergePasswordInput] = useState('');
  const [isMergingChecklists, setIsMergingChecklists] = useState(false);

  // Modal de seguridad para borrar lote con contraseña
  const [deleteModalBatch, setDeleteModalBatch] = useState(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');

  // Buscador por modelo en la pantalla principal
  const [quickModelQuery, setQuickModelQuery] = useState('');

  const fileInputRef = useRef(null);
  const addMoreFilesInputRef = useRef(null);

  // Layout de almacenes y filas activas
  const mapLayout = useMemo(() => WarehouseMapController.loadMap(), []);
  const availableWarehouses = useMemo(() => mapLayout.warehouses.map(w => w.name), [mapLayout]);
  const availableRows = useMemo(() => mapLayout.rows.map(r => r.name), [mapLayout]);

  // Extraer todas las impresoras para el buscador por modelo y estadísticas
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(batches);
  }, [batches]);

  const quickModelResults = useMemo(() => {
    if (!quickModelQuery.trim()) return [];
    return InventoryController.filterPrinters(allPrinters, quickModelQuery.trim(), 'ALL').slice(0, 8);
  }, [allPrinters, quickModelQuery]);

  // Checklists reales de recepción de equipos nuevos (excluyendo el lote contenedor de Inventario Maestro)
  const receptionBatches = useMemo(() => {
    return batches.filter(b => !b.isMaster);
  }, [batches]);

  // Checklists pendientes / disponibles para escanear
  const pendingBatches = useMemo(() => {
    return receptionBatches.filter(b => b.status !== 'completed' && b.completed.length < b.expectedSeries.length);
  }, [receptionBatches]);

  // Checklists 100% completados para depurar del historial sin perder impresoras
  const completedBatches = useMemo(() => {
    return receptionBatches.filter(b => {
      const total = b.totalCount || b.expectedSeries.length;
      return (total > 0 && b.completed.length >= total) || (b.status === 'completed' && b.expectedSeries.length === 0);
    });
  }, [receptionBatches]);

  // Conteo de equipos del inventario que no tienen ubicación física asignada
  const unassignedEquipmentCount = useMemo(() => {
    const allExpected = InventoryController.extractAllExpectedPrinters(batches);
    return allExpected.filter(p => 
      !p.warehouseSpace || 
      !p.warehouseRow || 
      p.warehouseRow === 'Sin Asignar' || 
      p.warehouseSpace.trim() === ''
    ).length;
  }, [batches]);

  const handleClearCompletedBatches = async () => {
    if (completedBatches.length === 0) {
      alert("No hay checklists completados para depurar.");
      return;
    }
    const confirm = window.confirm(`¿Deseas depurar ${completedBatches.length} checklist(s) completado(s) del historial? Sus impresoras ya están preservadas en el Inventario Maestro.`);
    if (!confirm) return;

    try {
      const ids = completedBatches.map(b => b.id);
      await InventoryController.clearCompletedChecklists(ids);
      if (onStatusChange) onStatusChange();
    } catch (err) {
      alert("Error al depurar checklists: " + err.message);
    }
  };

  const hasAvailableChecklist = pendingBatches.length > 0;

  // Estadísticas globales
  const stats = useMemo(() => {
    const total = allPrinters.length;
    const consultas = allPrinters.filter(p => p.isConsulta).length;
    const bajas = allPrinters.filter(p => p.isBaja).length;
    return { total, consultas, bajas };
  }, [allPrinters]);

  // Conteo de series auto-corregidas por OCR en la subida pendiente
  const repairedSeriesCount = useMemo(() => {
    if (!pendingUploadData?.series) return 0;
    return pendingUploadData.series.filter(s => Boolean(s.repairedFrom)).length;
  }, [pendingUploadData?.series]);

  // Series mostradas en la vista previa editable
  const filteredPreviewSeries = useMemo(() => {
    if (!pendingUploadData?.series) return [];
    return pendingUploadData.series
      .map((item, idx) => ({ ...item, originalIndex: idx }))
      .filter(item => {
        if (previewFilterMode === 'REPAIRED' && !item.repairedFrom) return false;
        if (previewSearch.trim()) {
          const q = previewSearch.trim().toLowerCase();
          const sMatch = (item.serial || '').toLowerCase().includes(q);
          const rMatch = (item.repairedFrom || '').toLowerCase().includes(q);
          const dMatch = (item.documentName || '').toLowerCase().includes(q);
          if (!sMatch && !rMatch && !dMatch) return false;
        }
        return true;
      });
  }, [pendingUploadData?.series, previewFilterMode, previewSearch]);

  // Editar una serie en la vista previa antes de crear el checklist
  const handleUpdatePreviewSerial = (index, newValue) => {
    if (!pendingUploadData) return;
    const cleanVal = String(newValue || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setPendingUploadData(prev => {
      const nextSeries = [...prev.series];
      nextSeries[index] = {
        ...nextSeries[index],
        serial: cleanVal
      };
      return { ...prev, series: nextSeries };
    });
  };

  // Eliminar una serie de la vista previa antes de crear el checklist
  const handleRemovePreviewSerial = (index) => {
    if (!pendingUploadData) return;
    setPendingUploadData(prev => {
      const nextSeries = prev.series.filter((_, idx) => idx !== index);
      return { ...prev, series: nextSeries };
    });
  };

  // Agregar manualmente una serie que faltara en el PDF
  const handleAddManualPreviewSerial = () => {
    if (!pendingUploadData) return;
    const cleanSerial = newManualSerial.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!cleanSerial) return;

    const alreadyExists = pendingUploadData.series.some(s => s.serial.toUpperCase() === cleanSerial);
    if (alreadyExists) {
      alert(`La serie ${cleanSerial} ya está en la lista de este checklist.`);
      return;
    }

    const defaultModel = newManualMaterial.trim().toUpperCase()
      || pendingUploadData.series[0]?.material
      || 'MODELO GENERAL';

    const defaultDoc = pendingUploadData.files?.[0]?.name || 'Manual';

    setPendingUploadData(prev => ({
      ...prev,
      series: [
        {
          serial: cleanSerial,
          material: defaultModel,
          documentName: defaultDoc,
          repairedFrom: 'AGREGADA MANUAL'
        },
        ...prev.series
      ]
    }));
    setNewManualSerial('');
  };

  // Procesa uno o varios archivos (PDF / Excel) y devuelve sus series combinadas sin duplicados
  const processUploadedFiles = async (fileList, existingData = null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setIsProcessingFile(true);

    try {
      const combinedSeries = existingData ? [...existingData.series] : [];
      const seenSerials = new Set(combinedSeries.map(s => String(s.serial).trim().toUpperCase()));
      const fileSummaries = existingData?.files ? [...existingData.files] : [];

      for (const file of files) {
        let extracted = [];
        if (file.name.toLowerCase().endsWith('.pdf')) {
          const { extractSeriesFromPDF } = await import('../utils/pdfParser.js');
          extracted = await extractSeriesFromPDF(file, (p) => setProcessingProgress(p.message));
        } else {
          extracted = await extractSeriesFromExcel(file);
        }

        let addedFromFile = 0;
        let repairedInFile = 0;
        for (const item of extracted) {
          const sUpper = String(item.serial || '').trim().toUpperCase();
          if (sUpper && !seenSerials.has(sUpper)) {
            seenSerials.add(sUpper);
            if (item.repairedFrom) repairedInFile++;
            combinedSeries.push({
              ...item,
              documentName: file.name
            });
            addedFromFile++;
          }
        }

        fileSummaries.push({
          name: file.name,
          count: extracted.length,
          addedCount: addedFromFile,
          repairedCount: repairedInFile
        });
      }

      if (combinedSeries.length === 0) {
        alert("No se encontraron números de serie. Verifica el formato del documento.");
        setIsProcessingFile(false);
        return;
      }

      const combinedFileName = fileSummaries.length === 1
        ? fileSummaries[0].name
        : `${fileSummaries[0].name.replace(/\.[^/.]+$/, '')} (+${fileSummaries.length - 1} doc${fileSummaries.length - 1 > 1 ? 's' : ''})`;

      if (!existingData) {
        setManualConsecutiveInput('');
        setUploadPasswordInput('');
        setUploadSaveMode('NEW');
        setUploadMergeTargetId(receptionBatches[0]?.id ? String(receptionBatches[0].id) : '');
        setUploadMergeListMode('UNION');
        setShowSeriesPreview(false);
        setPreviewFilterMode('ALL');
        setPreviewSearch('');
      }

      setPendingUploadData({
        fileName: combinedFileName,
        files: fileSummaries,
        series: combinedSeries
      });
    } catch (error) {
      alert("Error al procesar el documento: " + error.message);
    } finally {
      setIsProcessingFile(false);
      setProcessingProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (addMoreFilesInputRef.current) addMoreFilesInputRef.current.value = '';
    }
  };

  // Subida inicial de uno o varios Excel / PDF
  const handleFileUpload = async (e) => {
    await processUploadedFiles(e.target.files, null);
  };

  // Agregar más documentos PDF/Excel al mismo checklist antes de guardarlo
  const handleAddMoreFiles = async (e) => {
    await processUploadedFiles(e.target.files, pendingUploadData);
  };

  const handleConfirmCreateBatch = async (e) => {
    e.preventDefault();
    if (!pendingUploadData) return;

    if (uploadPasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. Se requiere autorización para subir documentos.");
      return;
    }

    const validSeries = pendingUploadData.series.filter(s => Boolean(s.serial && s.serial.trim()));
    if (validSeries.length === 0) {
      alert("No hay series válidas para guardar.");
      return;
    }

    if (uploadSaveMode === 'MERGE_EXISTING') {
      if (!uploadMergeTargetId) {
        alert("Selecciona el checklist con el que deseas fusionar estas series.");
        return;
      }
      try {
        setIsProcessingFile(true);
        const res = await ChecklistController.mergeSeriesIntoChecklist(
          uploadMergeTargetId,
          validSeries,
          uploadMergeListMode
        );
        setPendingUploadData(null);
        setManualConsecutiveInput('');
        setUploadPasswordInput('');
        if (onStatusChange) await onStatusChange();
        if (res.autoMatchedFromErrors > 0) {
          alert(`¡Checklist fusionado con éxito! Se agregaron ${res.addedCount} series nuevas y ${res.autoMatchedFromErrors} lectura(s) que estaban en error pasaron automáticamente a VERIFICADAS.`);
        }
        onSelectBatch(Number(uploadMergeTargetId) || uploadMergeTargetId);
      } catch (err) {
        alert("Error al fusionar con el checklist: " + err.message);
      } finally {
        setIsProcessingFile(false);
      }
      return;
    }

    const trimmedConsecutive = manualConsecutiveInput.trim();
    if (!trimmedConsecutive) {
      alert("Por favor ingresa el número consecutivo de inventario para este checklist.");
      return;
    }

    onCreateBatch(pendingUploadData.fileName, validSeries, trimmedConsecutive);
    setPendingUploadData(null);
    setManualConsecutiveInput('');
    setUploadPasswordInput('');
  };

  // Abrir el modal de Fusión de Checklists
  const handleOpenMergeModal = () => {
    const defaultSelected = receptionBatches.slice(0, 2).map(b => String(b.id));
    setSelectedMergeBatchIds(defaultSelected);

    // Sugerir como checklist destino el que tenga más escaneos realizados para no mover a los operadores de sesión
    const sortedByScanned = [...receptionBatches].sort((a, b) => (b.completed?.length || 0) - (a.completed?.length || 0));
    const bestTarget = sortedByScanned[0]?.id ? String(sortedByScanned[0].id) : (defaultSelected[0] || '');
    setMergeTargetBatchId(bestTarget);
    setMergeBaseListBatchId(defaultSelected[0] || bestTarget);
    setMergeMode('UNION');
    setMergePasswordInput('');
    setShowMergeModal(true);
  };

  const handleToggleMergeBatch = (batchIdStr) => {
    setSelectedMergeBatchIds(prev => {
      const exists = prev.includes(batchIdStr);
      const next = exists ? prev.filter(id => id !== batchIdStr) : [...prev, batchIdStr];
      if (next.length > 0 && !next.includes(String(mergeTargetBatchId))) {
        setMergeTargetBatchId(next[0]);
      }
      if (next.length > 0 && !next.includes(String(mergeBaseListBatchId))) {
        setMergeBaseListBatchId(next[0]);
      }
      return next;
    });
  };

  // Vista previa en tiempo real de lo que ocurrirá al fusionar los checklists seleccionados
  const mergePreviewStats = useMemo(() => {
    const selectedBatches = receptionBatches.filter(b => selectedMergeBatchIds.includes(String(b.id)));
    if (selectedBatches.length < 2) return null;

    const allSerialsSet = new Set();
    const scannedSerialsSet = new Set();
    const unexpectedSerialsSet = new Set();
    const baseBatch = selectedBatches.find(b => String(b.id) === String(mergeBaseListBatchId)) || selectedBatches[0];
    const baseSerialsSet = new Set((baseBatch?.expectedSeries || []).map(s => String(s.serial || '').trim().toUpperCase()));

    for (const b of selectedBatches) {
      for (const s of (b.expectedSeries || [])) {
        const clean = String(s.serial || '').trim().toUpperCase();
        if (!clean) continue;
        allSerialsSet.add(clean);
        if (s.isScanned || (b.completed || []).includes(clean)) {
          scannedSerialsSet.add(clean);
        }
      }
      for (const u of (b.unexpectedLogs || [])) {
        const raw = typeof u === 'string' ? u : (u?.scannedValue || u?.scanned_value || '');
        const cleanU = String(raw || '').split('|')[0].trim().toUpperCase();
        if (cleanU) unexpectedSerialsSet.add(cleanU);
      }
    }

    const effectiveExpectedSet = new Set();
    for (const s of allSerialsSet) {
      if (mergeMode === 'BASE_LIST' && !baseSerialsSet.has(s) && !scannedSerialsSet.has(s)) {
        continue;
      }
      effectiveExpectedSet.add(s);
    }

    const autoMatchedErrors = [];
    for (const errSerial of unexpectedSerialsSet) {
      if (effectiveExpectedSet.has(errSerial) && !scannedSerialsSet.has(errSerial)) {
        autoMatchedErrors.push(errSerial);
      }
    }

    return {
      totalSeries: effectiveExpectedSet.size,
      alreadyScanned: scannedSerialsSet.size,
      autoMatchedErrors,
      totalVerifiedAfterMerge: scannedSerialsSet.size + autoMatchedErrors.length,
      pendingAfterMerge: Math.max(0, effectiveExpectedSet.size - (scannedSerialsSet.size + autoMatchedErrors.length))
    };
  }, [receptionBatches, selectedMergeBatchIds, mergeMode, mergeBaseListBatchId]);

  const handleConfirmMergeChecklists = async (e) => {
    e.preventDefault();
    if (selectedMergeBatchIds.length < 2) {
      alert("Selecciona al menos 2 checklists para fusionar.");
      return;
    }
    if (mergePasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. Ingresa la clave de autorización (QWERTY).");
      return;
    }

    const targetId = mergeTargetBatchId && selectedMergeBatchIds.includes(String(mergeTargetBatchId))
      ? mergeTargetBatchId
      : selectedMergeBatchIds[0];
    const sourceIds = selectedMergeBatchIds.filter(id => String(id) !== String(targetId));

    try {
      setIsMergingChecklists(true);
      const res = await ChecklistController.mergeChecklists({
        targetChecklistId: targetId,
        sourceChecklistIds: sourceIds,
        mode: mergeMode,
        baseListChecklistId: mergeMode === 'BASE_LIST' ? (mergeBaseListBatchId || targetId) : targetId,
        deleteSources: true
      });
      setShowMergeModal(false);
      setMergePasswordInput('');
      if (onStatusChange) await onStatusChange();
      alert(
        `¡Checklists fusionados correctamente!\n` +
        `• Total en checklist combinado: ${res.totalSeries} equipos\n` +
        `• Equipos verificados: ${res.totalScanned}\n` +
        (res.autoMatchedFromErrors > 0
          ? `• ✨ Correspondencias automáticas desde errores: ${res.autoMatchedFromErrors} serie(s) pasaron a VERIFICADAS.`
          : '')
      );
      onSelectBatch(Number(targetId) || targetId);
    } catch (err) {
      alert("Error al fusionar checklists: " + err.message);
    } finally {
      setIsMergingChecklists(false);
    }
  };

  const handleRequestDelete = (batch) => {
    setDeleteModalBatch(batch);
    setDeletePasswordInput('');
  };

  const handleConfirmDeleteBatch = (e) => {
    e.preventDefault();
    if (!deleteModalBatch) return;

    if (deletePasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. No se puede eliminar el documento.");
      return;
    }

    onDeleteBatch(deleteModalBatch.id);
    setDeleteModalBatch(null);
    setDeletePasswordInput('');
  };

  return (
    <div className="flex flex-col flex-1 gap-6 animate-fade-in w-full pb-16">
      
      {/* CABECERA EXPLICATIVA DE RECEPCIONES */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-lg shadow-xs shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Recepciones y Checklists de Entrada (Camión)
              </h2>
              <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                Módulo de Lotes
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Sube los lotes entrantes para verificar qué llega. Los equipos <strong className="text-slate-800">NO se agregarán al Inventario Maestro hasta que les des lectura física</strong>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onNavigateToBajas && (
            <button
              type="button"
              onClick={() => onNavigateToBajas()}
              className="text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 border border-rose-800 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
              title="Entrar en Modo Bajas para escanear salidas de almacén"
            >
              <span>🔴</span>
              <span>Modo Bajas</span>
            </button>
          )}

          {onNavigateToMasterInventory && (
            <button
              type="button"
              onClick={onNavigateToMasterInventory}
              className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
            >
              <span>Ir al Inventario Maestro</span>
              <span>&rarr;</span>
            </button>
          )}
        </div>
      </div>

      {/* FILA SUPERIOR: SUBIR DOCUMENTO, ESTADO DE CHECKLIST Y RESUMEN RÁPIDO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
        {/* Input invisible para el archivo (permite seleccionar varios documentos a la vez) */}
        <input 
          type="file" 
          multiple
          accept=".pdf, .xlsx, .xls, .csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
        />
        {/* Input invisible para agregar más documentos al mismo checklist en el modal */}
        <input 
          type="file" 
          multiple
          accept=".pdf, .xlsx, .xls, .csv" 
          ref={addMoreFilesInputRef} 
          style={{ display: 'none' }} 
          onChange={handleAddMoreFiles} 
        />

        {/* Botón: Subir Checklist de Recepción */}
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessingFile}
          className={`flex items-center gap-3.5 bg-white border border-slate-200 hover:border-red-400 p-4 rounded-xl shadow-xs hover:shadow-sm transition-all group text-left ${isProcessingFile ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessingFile ? (
            <div className="w-11 h-11 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center animate-spin border-2 border-slate-300 border-t-red-600 shrink-0"></div>
          ) : (
            <div className="w-11 h-11 bg-red-50 text-red-600 rounded-lg flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
          )}
          <div>
            <span className="text-sm font-semibold text-slate-800 group-hover:text-red-700 block">
              {isProcessingFile ? (processingProgress || 'Leyendo documento(s)...') : 'Subir Checklist de Recepción (1 o varios PDFs)'}
            </span>
            <span className="text-xs text-slate-500 block mt-0.5 font-normal">
              Selecciona uno o varios archivos para unirlos en un checklist
            </span>
          </div>
        </button>

        {/* Indicador de Disponibilidad de Checklist */}
        {hasAvailableChecklist ? (
          <div 
            onClick={() => onSelectBatch(pendingBatches[0].id)}
            className="bg-emerald-50/70 border border-emerald-200 hover:border-emerald-300 p-4 rounded-xl flex items-center gap-3.5 shadow-xs cursor-pointer hover:bg-emerald-50 transition-all group"
          >
            <div className="w-11 h-11 bg-emerald-600 text-white rounded-lg flex items-center justify-center shrink-0 shadow-xs">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-emerald-900 block truncate">
                Checklist Disponible
              </span>
              <span className="text-xs text-emerald-700 font-medium block mt-0.5">
                {pendingBatches.length} lote(s) listos para escanear &rarr;
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center gap-3.5 shadow-xs">
            <div className="w-11 h-11 bg-slate-200 text-slate-500 rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-semibold text-slate-700 block">
                Sin Checklists Disponibles
              </span>
              <span className="text-xs text-slate-500 block mt-0.5">
                Todos los lotes completados
              </span>
            </div>
          </div>
        )}

        {/* Resumen de Inventario (Consulta / Baja) */}
        <div className="bg-white border border-slate-200 p-3.5 rounded-xl flex items-center justify-around shadow-xs">
          <div className="text-center px-2">
            <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider block">Total Equipos</span>
            <span className="text-lg font-bold text-slate-800">{stats.total}</span>
          </div>
          <div className="h-8 w-px bg-slate-200"></div>
          <div 
            onClick={onNavigateToModelSearch}
            className="text-center px-2 cursor-pointer hover:opacity-75 transition"
            title="Ver equipos en consulta"
          >
            <div className="flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span className="text-[11px] text-amber-800 font-medium uppercase tracking-wider">En Consulta</span>
            </div>
            <span className="text-lg font-bold text-amber-800">{stats.consultas}</span>
          </div>
          <div className="h-8 w-px bg-slate-200"></div>
          <div 
            onClick={onNavigateToModelSearch}
            className="text-center px-2 cursor-pointer hover:opacity-75 transition"
            title="Ver equipos dados de baja"
          >
            <div className="flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span className="text-[11px] text-rose-700 font-medium uppercase tracking-wider">De Baja</span>
            </div>
            <span className="text-lg font-bold text-rose-700">{stats.bajas}</span>
          </div>
        </div>
      </div>

      {/* CONTENEDOR PRINCIPAL: 2 COLUMNAS EN PANTALLA COMPLETA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">
        
        {/* COLUMNA IZQUIERDA: BUSCADOR POR MODELO, ASIGNACIÓN EN ALMACÉN Y LISTA DE CHECKLISTS */}
        <div className="lg:col-span-6 flex flex-col gap-6 w-full">
          
          {/* 1. BUSCADOR POR MODELO (CONSULTA / BAJA) */}
          <div className="w-full bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Buscador por Modelo de Impresora
                  </h3>
                  <p className="text-xs text-slate-500">
                    Consulta modelo para marcar en <span className="font-semibold text-amber-700">Consulta</span> o registrar <span className="font-semibold text-rose-600">Baja</span>.
                  </p>
                </div>
              </div>
              <button
                onClick={onNavigateToModelSearch}
                className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition"
              >
                Ver Todo &rarr;
              </button>
            </div>

            <div className="relative mt-2">
              <input
                type="text"
                className="w-full border border-slate-300 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl px-3.5 py-2 pl-9 text-xs uppercase font-medium text-slate-800 placeholder-slate-400"
                placeholder="ESCRIBE EL MODELO O SERIE (EJ: BROTHER, MXF...)..."
                value={quickModelQuery}
                onChange={(e) => setQuickModelQuery(e.target.value)}
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>

            {/* Resultados rápidos del buscador por modelo */}
            {quickModelQuery && (
              <div className="mt-3 flex flex-col gap-2">
                {quickModelResults.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center">No se encontraron impresoras con ese modelo o serie.</p>
                ) : (
                  quickModelResults.map((printer) => {
                    const badge = printer.getStatusBadge();
                    return (
                      <div 
                        key={printer.id || printer.serial}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 ${badge.cardBorder}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {printer.internalNumber && (
                              <span className="bg-slate-700 text-white font-bold text-[11px] px-2 py-0.5 rounded-md">
                                #{printer.internalNumber}
                              </span>
                            )}
                            <span className="font-mono font-bold text-slate-800 text-xs">{printer.serial}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.badgeClass}`}>
                              {badge.label}
                            </span>
                            <span className="text-[11px] text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                              {printer.warehouseRow} {printer.warehouseSpace ? `(${printer.warehouseSpace})` : ''}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 truncate">
                            Modelo: <span className="font-semibold text-slate-700">{printer.material}</span> | {printer.checklistFolio}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={async () => {
                              await InventoryController.markAsConsulta(printer.serial);
                              if (onStatusChange) onStatusChange();
                            }}
                            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                              printer.isConsulta 
                                ? 'bg-amber-400 text-amber-950 font-semibold' 
                                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            {printer.isConsulta ? 'En Consulta' : 'Consulta'}
                          </button>

                          <button
                            onClick={async () => {
                              if (window.confirm(`¿Confirmar BAJA de la impresora serie ${printer.serial}?`)) {
                                await InventoryController.markAsBaja(printer.serial);
                                if (onStatusChange) onStatusChange();
                              }
                            }}
                            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                              printer.isBaja 
                                ? 'bg-rose-700 text-white font-semibold' 
                                : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            {printer.isBaja ? 'Dada de Baja' : 'Baja'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 2. ACCESO DIRECTO AL INVENTARIO MAESTRO */}
          <div className="w-full bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
            <button
              type="button"
              onClick={onNavigateToMasterInventory || onNavigateToAssignment}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium p-4 rounded-xl transition flex items-center justify-between shadow-xs group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-700 text-red-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-left">
                  <span className="text-sm font-bold block text-white">
                    Inventario Maestro (Todas las Máquinas)
                  </span>
                  <span className="text-xs text-slate-300 block font-normal">
                    Tabla oficial con las 7 columnas, subida de Excel maestro y descargas
                  </span>
                </div>
              </div>
              <span className="text-slate-300 group-hover:text-white group-hover:translate-x-1 transition-transform text-sm">&rarr;</span>
            </button>
          </div>

          {/* 3. LISTA DE CHECKLISTS REGISTRADOS (CONTROL DE INVENTARIO) */}
          <div className="w-full bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Checklists y Recepciones de Entrada
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Lotes de llegada. Escanea equipos para sumarlos al inventario.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {receptionBatches.length >= 2 && (
                  <button
                    type="button"
                    onClick={handleOpenMergeModal}
                    className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition flex items-center gap-1 shadow-2xs cursor-pointer"
                    title="Fusionar 2 o más checklists conservando lo ya escaneado y cruzando correspondencias de errores"
                  >
                    <span>🔗</span>
                    <span>Fusionar Checklists</span>
                  </button>
                )}

                {completedBatches.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearCompletedBatches}
                    className="text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition flex items-center gap-1 shadow-2xs"
                    title="Limpiar del historial los checklists ya completados al 100% (las máquinas se conservan en el inventario)"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Depurar Finalizados ({completedBatches.length})
                  </button>
                )}

                <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
                  {receptionBatches.length} {receptionBatches.length === 1 ? 'checklist' : 'checklists'}
                </span>
              </div>
            </div>

            {receptionBatches.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-600 font-medium text-xs">No hay checklists de recepción de equipos nuevos registrados.</p>
                <p className="text-[11px] text-slate-400 mt-1">Sube un checklist de llegada arriba para comenzar.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {receptionBatches.map((batch) => {
                  const total = batch.totalCount || batch.expectedSeries.length;
                  const completedCount = batch.completed.length;
                  const pendingCount = batch.pendingCount;

                  const isFullCompleted = total > 0 && completedCount >= total;
                  const isClosedWithPending = (batch.status === 'completed' || batch.status === 'closed') && completedCount < total;

                  const modelsInBatch = Array.from(
                    new Set(batch.expectedSeries.map(s => s.material).filter(Boolean))
                  ).slice(0, 2).join(', ');

                  const batchBajasCount = (batch.expectedSeries || []).filter(p => p.isBaja || p.status === 'BAJA').length;

                  return (
                    <div key={batch.id} className="flex gap-2 items-center">
                      <button 
                        onClick={() => onSelectBatch(batch.id)}
                        className={`flex-1 flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-xl border transition-all text-left gap-2 ${
                          isFullCompleted
                            ? 'bg-emerald-50/40 border-emerald-200 hover:border-emerald-300' 
                            : isClosedWithPending
                            ? 'bg-amber-50/40 border-amber-200 hover:border-amber-300'
                            : 'bg-white border-slate-200 hover:border-red-400 hover:shadow-xs'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`font-bold text-xs px-2.5 py-1 rounded-lg uppercase tracking-wide shrink-0 ${
                            isFullCompleted ? 'bg-emerald-600 text-white' : isClosedWithPending ? 'bg-amber-600 text-white' : 'bg-red-600 text-white'
                          }`}>
                            {batch.folio}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 text-xs truncate">{batch.cleanName || batch.name}</p>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                              <span>{batch.date}</span>
                              {modelsInBatch && (
                                <span className="truncate">| <strong className="text-slate-600 font-medium">{modelsInBatch}</strong></span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            {batchBajasCount > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-800 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded-md mr-1.5 shadow-2xs">
                                📦 {batchBajasCount} {batchBajasCount === 1 ? 'baja' : 'bajas'}
                              </span>
                            )}
                            {isFullCompleted ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 border border-emerald-300 px-2.5 py-1 rounded-md shadow-2xs">
                                <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                </svg>
                                Completado ({total})
                              </span>
                            ) : isClosedWithPending ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-100/90 border border-amber-300 px-2.5 py-1 rounded-md shadow-2xs">
                                <svg className="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                Cerrado con faltantes ({pendingCount} de {total})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                Faltan: {pendingCount} de {total}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 text-xs">&rarr;</span>
                        </div>
                      </button>

                      {/* Botón para descargar reporte de este checklist en Excel */}
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          InventoryController.exportChecklistReportToExcel(batch);
                        }}
                        className="p-2.5 bg-white rounded-xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 text-slate-500 transition-colors shadow-2xs shrink-0"
                        title="Descargar Reporte del Checklist (Excel)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </button>

                      {/* Botón para eliminar checklist (con clave QWERTY) */}
                      <button 
                        type="button"
                        onClick={() => handleRequestDelete(batch)}
                        className="p-2.5 bg-white rounded-xl border border-slate-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 text-slate-400 transition-colors shrink-0"
                        title="Eliminar Checklist (Requiere autorización)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* BOTÓN ABAJO DE LA LISTA DE CHECKLISTS: LECTURA DE EQUIPOS */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={onNavigateToReading || onNavigateToAssignment}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold p-3.5 rounded-xl transition shadow-xs flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-800 text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold block text-white">
                        Lectura de Equipos
                      </span>
                      {unassignedEquipmentCount > 0 && (
                        <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-400">
                          {unassignedEquipmentCount} pendientes
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-emerald-100 block font-normal mt-0.5">
                      Dar ubicación (Almacén, Fila y Espacio) a los equipos que no tienen ubicación
                    </span>
                  </div>
                </div>
                <span className="text-emerald-200 group-hover:text-white group-hover:translate-x-1 transition-transform text-xs font-bold flex items-center gap-1">
                  <span>Iniciar Lectura</span>
                  <span>&rarr;</span>
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: MAPA DEL ALMACÉN (ALMACÉN 1 Y 2, FILAS Y RANGOS NUMÉRICOS) */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col w-full h-full">
          <WarehouseMapView 
            checklists={batches}
            onLayoutChange={onLayoutChange}
          />
        </div>

      </div>

      {/* MODAL OBLIGATORIO: CONSECUTIVO MANUAL, VISTA PREVIA EDITABLE Y CONTRASEÑA QWERTY AL SUBIR DOCUMENTO */}
      {pendingUploadData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form 
            onSubmit={handleConfirmCreateBatch}
            className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-fade-in-up flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-red-50 text-red-600 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Registrar Consecutivo de Inventario
                </h3>
                <p className="text-xs text-slate-500">
                  Documento: <span className="font-semibold text-slate-700">{pendingUploadData.fileName}</span>
                </p>
              </div>
            </div>

            {/* AVISO DESTACADO DE IMPRESORAS DETECTADAS, REPARACIONES OCR Y LISTA DE DOCUMENTOS */}
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-xl flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-semibold">
                    Total detectado: <strong className="text-sm font-black text-emerald-700">{pendingUploadData.series.length} impresoras</strong> ({pendingUploadData.files?.length || 1} doc{(pendingUploadData.files?.length || 1) > 1 ? 's' : ''})
                  </span>
                </div>

                {repairedSeriesCount > 0 && (
                  <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black px-2.5 py-0.5 rounded-full">
                    ✨ {repairedSeriesCount} corregida{repairedSeriesCount > 1 ? 's' : ''} por OCR
                  </span>
                )}
              </div>

              {pendingUploadData.files && pendingUploadData.files.length > 0 && (
                <div className="bg-white/90 rounded-lg p-2 border border-emerald-200/80 max-h-28 overflow-y-auto flex flex-col gap-1 text-[11px]">
                  {pendingUploadData.files.map((f, i) => (
                    <div key={i} className="flex justify-between items-center text-slate-700 px-1">
                      <span className="truncate font-medium max-w-[240px]">{i + 1}. {f.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {f.repairedCount > 0 && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                            ✨ {f.repairedCount} reparadas
                          </span>
                        )}
                        <span className="font-bold text-emerald-700">+{f.addedCount} series</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isProcessingFile}
                  onClick={() => addMoreFilesInputRef.current?.click()}
                  className="py-1.5 px-3 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <span>➕</span>
                  <span>{isProcessingFile ? (processingProgress || 'Leyendo...') : 'Agregar otro PDF / Doc'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSeriesPreview(!showSeriesPreview)}
                  className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <span>👁️</span>
                  <span>{showSeriesPreview ? 'Ocultar Vista Previa' : `Revisar / Editar Series (${pendingUploadData.series.length})`}</span>
                </button>
              </div>
            </div>

            {/* SECCIÓN DESPLEGABLE: VISTA PREVIA EDITABLE DE SERIES ANTES DE GUARDAR */}
            {showSeriesPreview && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-3 animate-fade-in">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewFilterMode('ALL')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                        previewFilterMode === 'ALL'
                          ? 'bg-slate-800 text-white'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Todas ({pendingUploadData.series.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFilterMode('REPAIRED')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                        previewFilterMode === 'REPAIRED'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      ✨ Corregidas por OCR ({repairedSeriesCount})
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="Buscar serie..."
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-800 uppercase outline-none w-40"
                  />
                </div>

                {/* Agregar serie manual en caso de que falte alguna en el documento */}
                <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-lg border border-slate-200">
                  <input
                    type="text"
                    placeholder="AGREGAR SERIE MANUAL (EJ: U66653...)"
                    value={newManualSerial}
                    onChange={(e) => setNewManualSerial(e.target.value)}
                    className="flex-1 min-w-[160px] bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-slate-800 uppercase outline-none"
                  />
                  <input
                    type="text"
                    placeholder="MODELO (OPCIONAL)"
                    value={newManualMaterial}
                    onChange={(e) => setNewManualMaterial(e.target.value)}
                    className="w-32 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 uppercase outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualPreviewSerial}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1 rounded-lg text-xs transition cursor-pointer"
                  >
                    + Agregar
                  </button>
                </div>

                {/* Lista editable de series */}
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {filteredPreviewSeries.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">
                      No hay series que coincidan con este filtro.
                    </p>
                  ) : (
                    filteredPreviewSeries.map((item) => (
                      <div
                        key={item.originalIndex}
                        className={`p-2 rounded-lg border flex items-center justify-between gap-2 text-xs ${
                          item.repairedFrom
                            ? 'bg-amber-50/70 border-amber-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 w-6">
                              #{item.originalIndex + 1}
                            </span>
                            <input
                              type="text"
                              value={item.serial}
                              onChange={(e) => handleUpdatePreviewSerial(item.originalIndex, e.target.value)}
                              className="font-mono font-bold text-slate-900 bg-transparent border-b border-transparent focus:border-red-500 focus:bg-white px-1 py-0.5 rounded outline-none uppercase w-44"
                              title="Haz clic para editar manualmente este número de serie"
                            />
                            <span className="text-[10px] text-slate-500 truncate">
                              {item.material}
                            </span>
                          </div>
                          {item.repairedFrom && (
                            <span className="text-[10px] text-amber-800 font-semibold pl-7">
                              ✨ OCR original: <span className="font-mono line-through">{item.repairedFrom}</span> ➔ <span className="font-mono font-bold text-emerald-800">{item.serial}</span>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemovePreviewSerial(item.originalIndex)}
                          className="text-slate-400 hover:text-rose-600 px-1.5 py-0.5 rounded font-bold text-xs"
                          title="Quitar esta serie del checklist"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-3">
              {receptionBatches.length > 0 && (
                <div className="flex flex-col gap-2 pb-2 border-b border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    ¿Cómo deseas guardar estas series?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setUploadSaveMode('NEW')}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-left ${
                        uploadSaveMode === 'NEW'
                          ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      ➕ Crear Nuevo Checklist
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadSaveMode('MERGE_EXISTING');
                        if (!uploadMergeTargetId && receptionBatches[0]) {
                          setUploadMergeTargetId(String(receptionBatches[0].id));
                        }
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-left ${
                        uploadSaveMode === 'MERGE_EXISTING'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🔗 Fusionar con Checklist en Curso
                    </button>
                  </div>
                </div>
              )}

              {uploadSaveMode === 'NEW' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                    Número Consecutivo de Checklist (Ingreso Manual):
                  </label>
                  <input
                    type="text"
                    required={uploadSaveMode === 'NEW'}
                    autoFocus
                    placeholder="EJ: 001, 105, 2026-A..."
                    value={manualConsecutiveInput}
                    onChange={(e) => setManualConsecutiveInput(e.target.value)}
                    className="w-full border border-slate-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 rounded-xl px-3 py-2 text-center text-sm font-bold text-slate-800 uppercase"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 bg-indigo-50/70 border border-indigo-200 p-3 rounded-xl">
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase mb-1">
                      Selecciona el Checklist en Curso para Fusionar:
                    </label>
                    <select
                      value={uploadMergeTargetId}
                      onChange={(e) => setUploadMergeTargetId(e.target.value)}
                      className="w-full bg-white border border-indigo-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                    >
                      {receptionBatches.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.folio} — {b.cleanName || b.name} ({b.completed?.length || 0}/{b.expectedSeries?.length || 0} escaneadas{(b.unexpectedLogs?.length || 0) > 0 ? `, ${b.unexpectedLogs.length} en error` : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold text-indigo-900 uppercase">
                      Modo de fusión:
                    </span>
                    <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="uploadMergeListMode"
                        checked={uploadMergeListMode === 'UNION'}
                        onChange={() => setUploadMergeListMode('UNION')}
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Combinar todas las series (Unión):</strong> Conserva lo ya escaneado, agrega las series faltantes y valida automáticamente las que habían dado error.
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="uploadMergeListMode"
                        checked={uploadMergeListMode === 'BASE_LIST'}
                        onChange={() => setUploadMergeListMode('BASE_LIST')}
                        className="mt-0.5"
                      />
                      <span>
                        <strong>Reemplazar lista base con este documento:</strong> Usa las {pendingUploadData.series.length} series de este PDF pero conserva todo lo ya escaneado y cruza los errores.
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Contraseña de Autorización:
                </label>
                <input
                  type="password"
                  required
                  placeholder="Ingresa contraseña requerida"
                  value={uploadPasswordInput}
                  onChange={(e) => setUploadPasswordInput(e.target.value)}
                  className="w-full border border-slate-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 rounded-xl px-3 py-2 text-center text-sm font-bold text-slate-800"
                />
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setPendingUploadData(null)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isProcessingFile}
                className={`flex-1 py-2.5 px-4 rounded-xl text-white font-bold text-xs transition shadow-xs ${
                  uploadSaveMode === 'MERGE_EXISTING'
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {uploadSaveMode === 'MERGE_EXISTING'
                  ? `🔗 Fusionar con Checklist (${pendingUploadData.series.length})`
                  : `Guardar Checklist (${pendingUploadData.series.length})`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL PARA FUSIONAR 2 O MÁS CHECKLISTS EXISTENTES Y CRUZAR CORRESPONDENCIAS */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleConfirmMergeChecklists}
            className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-fade-in-up flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 font-bold text-lg">
                  🔗
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">
                    Fusionar Checklists y Cruzar Correspondencias
                  </h3>
                  <p className="text-xs text-slate-500">
                    Combina checklists sin perder el avance escaneado y valida automáticamente lecturas en error.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            {/* 1. SELECCIÓN DE CHECKLISTS A FUSIONAR */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-700 uppercase">
                1. Selecciona los Checklists que deseas combinar ({selectedMergeBatchIds.length} seleccionados):
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {receptionBatches.map((b) => {
                  const idStr = String(b.id);
                  const isChecked = selectedMergeBatchIds.includes(idStr);
                  const scannedCnt = b.completed?.length || 0;
                  const totalCnt = b.expectedSeries?.length || 0;
                  const errCnt = b.unexpectedLogs?.length || 0;

                  return (
                    <label
                      key={b.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                        isChecked
                          ? 'bg-indigo-50/70 border-indigo-400 shadow-2xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleMergeBatch(idStr)}
                          className="w-4 h-4 accent-indigo-600 rounded shrink-0"
                        />
                        <span className="bg-slate-800 text-white font-bold text-[11px] px-2 py-0.5 rounded shrink-0">
                          {b.folio}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {b.cleanName || b.name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {b.date}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md border border-emerald-200">
                          ✓ {scannedCnt}/{totalCnt}
                        </span>
                        {errCnt > 0 && (
                          <span className="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-md border border-rose-200">
                            ⚠ {errCnt} error{errCnt > 1 ? 'es' : ''}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 2. SELECCIÓN DEL CHECKLIST DESTINO Y MODO DE COMBINACIÓN */}
            {selectedMergeBatchIds.length >= 2 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    2. Conservar Folio / Sesión Activa de:
                  </label>
                  <select
                    value={mergeTargetBatchId}
                    onChange={(e) => setMergeTargetBatchId(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                  >
                    {receptionBatches
                      .filter(b => selectedMergeBatchIds.includes(String(b.id)))
                      .map(b => (
                        <option key={b.id} value={String(b.id)}>
                          {b.folio} — {b.cleanName || b.name} ({b.completed?.length || 0} ya escaneadas)
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    3. Modo de Combinación:
                  </span>
                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="mergeMode"
                      checked={mergeMode === 'UNION'}
                      onChange={() => setMergeMode('UNION')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Unir todas las series (Recomendado):</strong> Combina todas las series únicas de los checklists seleccionados, conserva todas las máquinas escaneadas y pasa a verificadas las lecturas en error que coincidan.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="mergeMode"
                      checked={mergeMode === 'BASE_LIST'}
                      onChange={() => setMergeMode('BASE_LIST')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Usar lista de series de un checklist específico + transferir avance:</strong> Ideal si subiste un nuevo checklist con el PDF corregido y quieres pasarle lo ya escaneado del anterior.
                    </span>
                  </label>

                  {mergeMode === 'BASE_LIST' && (
                    <div className="pl-5 pt-1">
                      <label className="block text-[11px] font-bold text-indigo-800 uppercase mb-1">
                        Tomar la lista de series esperadas de:
                      </label>
                      <select
                        value={mergeBaseListBatchId}
                        onChange={(e) => setMergeBaseListBatchId(e.target.value)}
                        className="w-full bg-white border border-indigo-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none"
                      >
                        {receptionBatches
                          .filter(b => selectedMergeBatchIds.includes(String(b.id)))
                          .map(b => (
                            <option key={b.id} value={String(b.id)}>
                              {b.folio} — {b.cleanName || b.name} ({b.expectedSeries?.length || 0} series)
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* VISTA PREVIA EN TIEMPO REAL DE LA FUSIÓN Y CORRESPONDENCIAS */}
            {mergePreviewStats && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-indigo-950 uppercase">
                    📊 Resultado de la Fusión:
                  </span>
                  <span className="text-xs font-black text-indigo-700">
                    Total: {mergePreviewStats.totalSeries} series
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white p-2 rounded-lg border border-indigo-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Ya Escaneadas</span>
                    <span className="text-sm font-black text-emerald-700">{mergePreviewStats.alreadyScanned}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-indigo-100">
                    <span className="text-[10px] font-bold text-amber-700 uppercase block">✨ Cruce Errores</span>
                    <span className="text-sm font-black text-amber-600">+{mergePreviewStats.autoMatchedErrors.length}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-indigo-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Faltantes Finales</span>
                    <span className="text-sm font-black text-slate-800">{mergePreviewStats.pendingAfterMerge}</span>
                  </div>
                </div>

                {mergePreviewStats.autoMatchedErrors.length > 0 && (
                  <div className="bg-emerald-100/90 border border-emerald-300 rounded-lg p-2 text-[11px] text-emerald-950">
                    <strong>✨ ¡Correspondencias automáticas encontradas!</strong> Las siguientes series que habían marcado error ahora existen en la lista combinada y quedarán <strong>VERIFICADAS</strong> automáticamente:
                    <div className="font-mono font-bold text-emerald-900 mt-1 flex flex-wrap gap-1">
                      {mergePreviewStats.autoMatchedErrors.map(s => (
                        <span key={s} className="bg-white px-2 py-0.5 rounded border border-emerald-300">
                          ✓ {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Contraseña de Autorización:
              </label>
              <input
                type="password"
                required
                placeholder="Ingresa contraseña requerida (QWERTY)"
                value={mergePasswordInput}
                onChange={(e) => setMergePasswordInput(e.target.value)}
                className="w-full border border-slate-300 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 rounded-xl px-3 py-2 text-center text-sm font-bold text-slate-800"
              />
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isMergingChecklists || selectedMergeBatchIds.length < 2}
                className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs transition shadow-xs cursor-pointer"
              >
                {isMergingChecklists ? 'Fusionando Checklists...' : '🔗 Confirmar Fusión'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DE SEGURIDAD: CONTRASEÑA QWERTY PARA ELIMINAR LOTE */}
      {deleteModalBatch && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmDeleteBatch}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 animate-fade-in-up flex flex-col gap-3"
          >
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">
                Eliminar Checklist / Folio
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                ¿Deseas eliminar <span className="font-semibold text-slate-700">{deleteModalBatch.folio}</span> ({deleteModalBatch.cleanName || deleteModalBatch.name})?
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Contraseña de Confirmación:
              </label>
              <input
                type="password"
                required
                autoFocus
                placeholder="INGRESA CONTRASEÑA PARA BORRAR"
                value={deletePasswordInput}
                onChange={(e) => setDeletePasswordInput(e.target.value)}
                className="w-full border border-slate-300 focus:border-rose-600 focus:ring-2 focus:ring-rose-100 rounded-xl px-3 py-2 text-center text-sm font-bold text-slate-800"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalBatch(null)}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition shadow-xs"
              >
                Confirmar Borrado
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
