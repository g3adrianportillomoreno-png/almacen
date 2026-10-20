import { useState, useMemo, useRef } from 'react';
import { InventoryController } from '../controllers/InventoryController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import { extractSeriesFromExcel } from '../utils/excelParser.js';

export default function MasterInventoryView({
  allPrinters = [],
  onInventoryChange,
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4'],
  onNavigateToChecklists
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');
  const [rowFilter, setRowFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL', 'ASSIGNED', 'UNASSIGNED', 'NEW'
  const [systemStateFilter, setSystemStateFilter] = useState('ALL'); // 'ALL', 'Principal', 'Seminuevos', 'Remanufacturado', 'Refacciones para operaciones'
  
  // Modal de edición de ubicación
  const [editingPrinter, setEditingPrinter] = useState(null);
  const [editWarehouse, setEditWarehouse] = useState('');
  const [editRow, setEditRow] = useState('');
  const [editSpace, setEditSpace] = useState('');
  const [editInternalNumber, setEditInternalNumber] = useState('');
  const [editSystemStatus, setEditSystemStatus] = useState('Principal');
  const [customWarehouseInput, setCustomWarehouseInput] = useState('');
  const [showCustomWarehouse, setShowCustomWarehouse] = useState(false);
  const [customRowInput, setCustomRowInput] = useState('');
  const [showCustomRow, setShowCustomRow] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Subida de Excel Maestro y Reconciliación
  const [isUploading, setIsUploading] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const fileInputRef = useRef(null);

  // Actualización de Maestro con purga de Bajas por Diferencia
  const [pendingUpdateData, setPendingUpdateData] = useState(null);
  const [updatePasswordInput, setUpdatePasswordInput] = useState('');
  const [isExecutingUpdate, setIsExecutingUpdate] = useState(false);
  const updateFileInputRef = useRef(null);

  // Historial de Bajas (30 días)
  const [showDeparturesModal, setShowDeparturesModal] = useState(false);
  const [departuresList, setDeparturesList] = useState([]);
  const [isLoadingDepartures, setIsLoadingDepartures] = useState(false);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Lista única de almacenes encontrados en las impresoras
  const warehouseList = useMemo(() => {
    const set = new Set(availableWarehouses);
    allPrinters.forEach(p => {
      if (p.warehouseName && p.warehouseName.trim()) set.add(p.warehouseName.trim());
    });
    return Array.from(set).sort();
  }, [availableWarehouses, allPrinters]);

  // Lista única de filas encontradas en las impresoras
  const rowList = useMemo(() => {
    const set = new Set(availableRows);
    allPrinters.forEach(p => {
      if (p.warehouseRow && p.warehouseRow.trim() && p.warehouseRow !== 'Sin Asignar') {
        set.add(p.warehouseRow.trim());
      }
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [availableRows, allPrinters]);

  // Métricas
  const stats = useMemo(() => {
    const total = allPrinters.length;
    const conUbicacion = allPrinters.filter(p => p.warehouseSpace && p.warehouseRow && p.warehouseRow !== 'Sin Asignar').length;
    const sinUbicacion = total - conUbicacion;
    const sinNumeroEquipo = allPrinters.filter(p => !p.internalNumber || String(p.internalNumber).trim() === '').length;
    const principal = allPrinters.filter(p => (p.systemStatus || 'Principal') === 'Principal').length;
    const seminuevos = allPrinters.filter(p => p.systemStatus === 'Seminuevos').length;
    const remanufacturado = allPrinters.filter(p => p.systemStatus === 'Remanufacturado').length;
    const refacciones = allPrinters.filter(p => p.systemStatus === 'Refacciones para operaciones').length;
    return { total, conUbicacion, sinUbicacion, sinNumeroEquipo, principal, seminuevos, remanufacturado, refacciones };
  }, [allPrinters]);

  // Filtrado de impresoras
  const filteredPrinters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allPrinters.filter(p => {
      // Filtro por texto
      if (query) {
        const matchesSerial = (p.serial || '').toLowerCase().includes(query);
        const matchesModel = (p.material || '').toLowerCase().includes(query);
        const matchesInternal = String(p.internalNumber || '').toLowerCase().includes(query);
        const matchesSpace = (p.warehouseSpace || '').toLowerCase().includes(query);
        const matchesSystemStatus = (p.systemStatus || '').toLowerCase().includes(query);
        if (!matchesSerial && !matchesModel && !matchesInternal && !matchesSpace && !matchesSystemStatus) {
          return false;
        }
      }

      // Filtro por Almacén
      if (warehouseFilter !== 'ALL') {
        if ((p.warehouseName || '') !== warehouseFilter) return false;
      }

      // Filtro por Fila
      if (rowFilter !== 'ALL') {
        if ((p.warehouseRow || '') !== rowFilter) return false;
      }

      // Filtro por Estado de Ubicación
      if (statusFilter === 'ASSIGNED') {
        if (!p.warehouseSpace || !p.warehouseRow || p.warehouseRow === 'Sin Asignar') return false;
      } else if (statusFilter === 'UNASSIGNED') {
        if (p.warehouseSpace && p.warehouseRow && p.warehouseRow !== 'Sin Asignar') return false;
      } else if (statusFilter === 'NEW') {
        if (p.internalNumber && String(p.internalNumber).trim() !== '') return false;
      }

      // Filtro por Estado de Proceso (Sistema)
      if (systemStateFilter !== 'ALL') {
        const itemStatus = p.systemStatus || 'Principal';
        if (itemStatus !== systemStateFilter) return false;
      }

      return true;
    });
  }, [allPrinters, searchQuery, warehouseFilter, rowFilter, statusFilter, systemStateFilter]);

  // Paginación
  const totalPages = Math.ceil(filteredPrinters.length / itemsPerPage) || 1;
  const paginatedPrinters = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredPrinters.slice(start, start + itemsPerPage);
  }, [filteredPrinters, currentPage]);

  // Validación de Colisión de Espacio en tiempo real
  const collisionOccupant = useMemo(() => {
    if (!editingPrinter) return null;
    const targetSpace = (editSpace || '').trim().toLowerCase();
    const targetRow = (editRow || '').trim().toLowerCase();
    const targetWh = (editWarehouse || '').trim().toLowerCase();

    if (!targetSpace || targetSpace === 'general' || !targetRow) return null;

    return allPrinters.find(p => {
      if (p.serial === editingPrinter.serial) return false;
      const pSpace = (p.warehouseSpace || '').trim().toLowerCase();
      const pRow = (p.warehouseRow || '').trim().toLowerCase();
      const pWh = (p.warehouseName || '').trim().toLowerCase();

      return pSpace === targetSpace && pRow === targetRow && pWh === targetWh;
    });
  }, [editingPrinter, editSpace, editRow, editWarehouse, allPrinters]);

  // Abrir modal de edición
  const handleOpenEdit = (printer) => {
    setEditingPrinter(printer);
    setEditWarehouse(printer.warehouseName || warehouseList[0] || 'Almacén 1');
    setEditRow(printer.warehouseRow && printer.warehouseRow !== 'Sin Asignar' ? printer.warehouseRow : (rowList[0] || 'Fila 1'));
    setEditSpace(printer.warehouseSpace || '');
    setEditInternalNumber(printer.internalNumber !== null && printer.internalNumber !== undefined ? String(printer.internalNumber) : '');
    setEditSystemStatus(printer.systemStatus || 'Principal');
    setShowCustomWarehouse(false);
    setShowCustomRow(false);
    setCustomWarehouseInput('');
    setCustomRowInput('');
  };

  // Guardar reubicación física y estado
  const handleSaveLocation = async (e) => {
    e.preventDefault();
    if (!editingPrinter) return;

    if (collisionOccupant) {
      alert(`¡Espacio ocupado! El espacio "${editSpace}" en ${editRow} (${editWarehouse}) ya está ocupado por la serie ${collisionOccupant.serial}. Elige otro espacio.`);
      return;
    }

    setIsSaving(true);
    try {
      const spaceFinal = editSpace.trim();
      const internalFinal = editInternalNumber.trim() !== '' ? editInternalNumber.trim() : null;

      await InventoryController.assignPrinter(editingPrinter.serial, {
        warehouseName: editWarehouse,
        warehouseRow: editRow,
        warehouseSpace: spaceFinal,
        internalNumber: internalFinal,
        systemStatus: editSystemStatus
      });

      // Asegurar que la fila se refleje en el plano si es nueva
      if (editRow) {
        WarehouseMapController.ensureRowExists(editRow, editWarehouse);
      }

      setEditingPrinter(null);
      if (onInventoryChange) onInventoryChange();
    } catch (err) {
      alert("Error al actualizar la ubicación: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Subir Excel Maestro para Reconciliación
  const handleMasterExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setReconcileResult(null);

    try {
      const extractedRows = await extractSeriesFromExcel(file);
      if (extractedRows.length === 0) {
        alert("No se detectaron series en el documento. Asegúrate de incluir la columna 'NUMERO DE SERIE'.");
        setIsUploading(false);
        return;
      }

      const result = await InventoryController.reconcileAndImportMasterExcel(extractedRows);
      setReconcileResult({
        fileName: file.name,
        total: result.total,
        updated: result.updated,
        added: result.added
      });

      if (onInventoryChange) onInventoryChange();
    } catch (err) {
      alert("Error al procesar el archivo Excel Maestro: " + err.message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Manejo de actualización de maestro con purga de bajas por diferencia
  const handleUpdateExcelSelected = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const extractedRows = await extractSeriesFromExcel(file);
      if (extractedRows.length === 0) {
        alert("No se detectaron series en el documento. Asegúrate de incluir la columna 'NUMERO DE SERIE'.");
        return;
      }

      // Comparar contra el inventario actual para detectar qué impresoras ya no vienen
      const newSerialsSet = new Set(extractedRows.map(r => r.serial.toUpperCase()));
      const removedPrinters = allPrinters.filter(p => !newSerialsSet.has(p.serial.toUpperCase()));

      setPendingUpdateData({
        fileName: file.name,
        extractedRows,
        removedPrinters
      });
      setUpdatePasswordInput('');
    } catch (err) {
      alert("Error al analizar el archivo para actualización: " + err.message);
    } finally {
      if (updateFileInputRef.current) updateFileInputRef.current.value = '';
    }
  };

  const handleConfirmUpdate = async (e) => {
    e.preventDefault();
    if (!pendingUpdateData) return;

    if (updatePasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. Se requiere autorización (QWERTY) para aplicar bajas y actualizar el maestro.");
      return;
    }

    setIsExecutingUpdate(true);
    try {
      const res = await InventoryController.updateMasterInventoryWithPurge(
        pendingUpdateData.extractedRows,
        pendingUpdateData.removedPrinters
      );

      alert(
        `✓ Actualización de Inventario Maestro completada con éxito:\n\n` +
        `• Impresoras leídas del archivo: ${res.totalRead}\n` +
        `• Bajas registradas / eliminadas: ${res.removedCount}\n` +
        `• Impresoras actualizadas: ${res.updated}\n` +
        `• Impresoras nuevas agregadas: ${res.added}`
      );

      setPendingUpdateData(null);
      setUpdatePasswordInput('');
      if (onInventoryChange) onInventoryChange();
    } catch (err) {
      alert("Error al actualizar el inventario maestro: " + err.message);
    } finally {
      setIsExecutingUpdate(false);
    }
  };

  // Abrir historial de bajas de los últimos 30 días
  const handleOpenDepartures = async () => {
    setShowDeparturesModal(true);
    setIsLoadingDepartures(true);
    try {
      const data = await InventoryController.getDeparturesHistory();
      setDeparturesList(data);
    } catch (err) {
      console.warn("Error cargando bajas:", err);
    } finally {
      setIsLoadingDepartures(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full animate-fade-in pb-12">
      {/* Input invisible para subir Excel Maestro */}
      <input 
        type="file" 
        accept=".xlsx, .xls, .csv" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleMasterExcelUpload} 
      />

      {/* Input invisible para actualizar Excel Maestro con bajas por diferencia */}
      <input 
        type="file" 
        accept=".xlsx, .xls, .csv" 
        ref={updateFileInputRef} 
        style={{ display: 'none' }} 
        onChange={handleUpdateExcelSelected} 
      />

      {/* APARTADO EXCLUSIVO: SUBIR / ACTUALIZAR ARCHIVO MAESTRO */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-6 shadow-md border border-slate-700">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-red-600 text-white font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Base de Datos de Almacén
              </span>
              <span className="text-slate-400 text-xs">
                Exclusivo para Inventario Maestro
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">
              Cargar o Actualizar Archivo Maestro de Inventario
            </h2>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Sube el archivo Excel con las <strong className="text-white">3 primeras columnas</strong> (<em>Clave, Número de serie, Número de equipo</em>) para registrar o relacionar equipos, o con las <strong className="text-white">6 o 7 columnas completas</strong> (incluyendo <em>Almacén, Fila, Espacio, Estado</em>) para actualizar ubicaciones y estados de todo el almacén.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 mt-3 text-[11px] text-slate-300">
              <span className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 px-2.5 py-1 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                Opción A: 3 Columnas (Clave, Serie, No. de Equipo)
              </span>
              <span className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 px-2.5 py-1 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Opción B: 6 o 7 Columnas (+ Ubicación y Estado)
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 w-full lg:w-auto shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition shadow-sm flex items-center justify-center gap-2 ${
                isUploading ? 'opacity-60 cursor-not-allowed' : ''
              }`}
              title="Sube un archivo para agregar o actualizar equipos existentes sin eliminar bajas"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Procesando archivo...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Subir Archivo Maestro (Excel)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => updateFileInputRef.current?.click()}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
              title="Reconcilia contra un nuevo Excel y borra las impresoras ausentes (registrando bajas)"
            >
              <svg className="w-4 h-4 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Actualizar (Bajas por Diferencia)</span>
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleOpenDepartures}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-3 rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-700"
                title="Ver historial de bajas de los últimos 30 días"
              >
                <span>📋 Bajas (30 d)</span>
              </button>

              <button
                type="button"
                onClick={() => InventoryController.exportInventoryReportToExcel(allPrinters)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold py-2 px-3 rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-600"
              >
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Descargar</span>
              </button>
            </div>
          </div>
        </div>

        {/* Separación y aclaración clara para no confundir con checklists */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400">ℹ️</span>
            <span>
              <strong>Nota:</strong> Los lotes nuevos de camiones se registran en <strong>Recepciones (Checklists)</strong>. Las máquinas no entrarán al Inventario Maestro hasta que se les dé lectura física.
            </span>
          </div>
          {onNavigateToChecklists && (
            <button
              type="button"
              onClick={onNavigateToChecklists}
              className="text-red-400 hover:text-red-300 font-semibold underline shrink-0"
            >
              Ir a Recepciones (Checklists) &rarr;
            </button>
          )}
        </div>
      </div>

      {/* BANNER DE RESULTADO DE RECONCILIACIÓN */}
      {reconcileResult && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-xs animate-fade-in shadow-2xs flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
              ✓
            </div>
            <div>
              <p className="font-bold text-emerald-950 text-sm">
                ¡Reconciliación de "{reconcileResult.fileName}" completada con éxito!
              </p>
              <p className="text-emerald-800 mt-0.5">
                Procesadas: <strong>{reconcileResult.total}</strong> | Vinculadas/Actualizadas con No. de Equipo: <strong>{reconcileResult.updated}</strong> | Nuevas agregadas: <strong>{reconcileResult.added}</strong>
              </p>
            </div>
          </div>
          <button 
            onClick={() => setReconcileResult(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold px-2 py-1 text-xs"
          >
            ✕ Cerrar
          </button>
        </div>
      )}

      {/* TARJETAS DE MÉTRICAS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs text-center">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total en Almacén
          </span>
          <span className="text-xl font-black text-slate-800 mt-0.5 block">
            {stats.total}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs text-center bg-emerald-50/30">
          <span className="block text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
            Con Ubicación Física
          </span>
          <span className="text-xl font-black text-emerald-700 mt-0.5 block">
            {stats.conUbicacion}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-amber-200 shadow-xs text-center bg-amber-50/30">
          <span className="block text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
            Sin Ubicar
          </span>
          <span className="text-xl font-black text-amber-800 mt-0.5 block">
            {stats.sinUbicacion}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-purple-200 shadow-xs text-center bg-purple-50/30">
          <span className="block text-[11px] font-semibold text-purple-700 uppercase tracking-wider">
            Nuevas (Sin No. Equipo)
          </span>
          <span className="text-xl font-black text-purple-700 mt-0.5 block">
            {stats.sinNumeroEquipo}
          </span>
        </div>
      </div>

      {/* MÉTRICAS POR ESTADO DE PROCESO / SISTEMA */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => {
            setSystemStateFilter(prev => prev === 'Principal' ? 'ALL' : 'Principal');
            setCurrentPage(1);
          }}
          className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between ${
            systemStateFilter === 'Principal' 
              ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' 
              : 'bg-blue-50/50 hover:bg-blue-50 border-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
            <span className="text-[11px] font-bold text-blue-950">Principal</span>
          </div>
          <span className="text-xs font-black text-blue-900 bg-white/80 px-2 py-0.5 rounded-md border border-blue-200">
            {stats.principal}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSystemStateFilter(prev => prev === 'Seminuevos' ? 'ALL' : 'Seminuevos');
            setCurrentPage(1);
          }}
          className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between ${
            systemStateFilter === 'Seminuevos' 
              ? 'bg-orange-100 border-orange-400 ring-2 ring-orange-300' 
              : 'bg-orange-50/50 hover:bg-orange-50 border-orange-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
            <span className="text-[11px] font-bold text-orange-950">Seminuevos</span>
          </div>
          <span className="text-xs font-black text-orange-900 bg-white/80 px-2 py-0.5 rounded-md border border-orange-200">
            {stats.seminuevos}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSystemStateFilter(prev => prev === 'Remanufacturado' ? 'ALL' : 'Remanufacturado');
            setCurrentPage(1);
          }}
          className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between ${
            systemStateFilter === 'Remanufacturado' 
              ? 'bg-emerald-100 border-emerald-400 ring-2 ring-emerald-300' 
              : 'bg-emerald-50/50 hover:bg-emerald-50 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="text-[11px] font-bold text-emerald-950">Remanufacturado</span>
          </div>
          <span className="text-xs font-black text-emerald-900 bg-white/80 px-2 py-0.5 rounded-md border border-emerald-200">
            {stats.remanufacturado}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSystemStateFilter(prev => prev === 'Refacciones para operaciones' ? 'ALL' : 'Refacciones para operaciones');
            setCurrentPage(1);
          }}
          className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between ${
            systemStateFilter === 'Refacciones para operaciones' 
              ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300' 
              : 'bg-amber-50/50 hover:bg-amber-50 border-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 truncate mr-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
            <span className="text-[11px] font-bold text-amber-950 truncate">Refacciones</span>
          </div>
          <span className="text-xs font-black text-amber-900 bg-white/80 px-2 py-0.5 rounded-md border border-amber-200 shrink-0">
            {stats.refacciones}
          </span>
        </button>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3">
        {/* Buscador */}
        <div className="relative flex-1">
          <input
            type="text"
            className="w-full border border-slate-300 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl px-4 py-2.5 pl-10 text-xs font-semibold uppercase text-slate-800 placeholder-slate-400"
            placeholder="BUSCAR POR SERIE, CLAVE / MODELO O NO. DE EQUIPO..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filtro por Almacén */}
        <div className="w-full md:w-36">
          <select
            value={warehouseFilter}
            onChange={(e) => {
              setWarehouseFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:border-red-500 outline-none"
          >
            <option value="ALL">Almacenes</option>
            {warehouseList.map((w, idx) => (
              <option key={idx} value={w}>{w}</option>
            ))}
          </select>
        </div>

        {/* Filtro por Fila */}
        <div className="w-full md:w-32">
          <select
            value={rowFilter}
            onChange={(e) => {
              setRowFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:border-red-500 outline-none"
          >
            <option value="ALL">Filas</option>
            {rowList.map((r, idx) => (
              <option key={idx} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Filtro por Ubicación */}
        <div className="w-full md:w-40">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:border-red-500 outline-none"
          >
            <option value="ALL">Todos (Ubicación)</option>
            <option value="ASSIGNED">Con Ubicación</option>
            <option value="UNASSIGNED">Sin Ubicar</option>
            <option value="NEW">Nuevas (Sin No.)</option>
          </select>
        </div>

        {/* Filtro por Estado (Sistema / Área) */}
        <div className="w-full md:w-48">
          <select
            value={systemStateFilter}
            onChange={(e) => {
              setSystemStateFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:border-red-500 outline-none"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="Principal">🔵 Principal ({stats.principal})</option>
            <option value="Seminuevos">🟠 Seminuevos ({stats.seminuevos})</option>
            <option value="Remanufacturado">🟢 Remanufacturado ({stats.remanufacturado})</option>
            <option value="Refacciones para operaciones">🟡 Refacciones ({stats.refacciones})</option>
          </select>
        </div>
      </div>

      {/* TABLA PRINCIPAL: LAS 7 COLUMNAS OFICIALES */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">1. Clave (Modelo)</th>
                <th className="py-3 px-4">2. Número de Serie</th>
                <th className="py-3 px-4">3. Número de Equipo</th>
                <th className="py-3 px-4">4. Almacén</th>
                <th className="py-3 px-4">5. Fila</th>
                <th className="py-3 px-4">6. Espacio</th>
                <th className="py-3 px-4">7. Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedPrinters.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      <p className="font-semibold text-slate-600">No se encontraron máquinas en el inventario.</p>
                      <p className="text-[11px] text-slate-400">Sube un Excel Maestro o realiza una recepción para agregar equipos.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedPrinters.map((printer, idx) => {
                  const globalIdx = (currentPage - 1) * itemsPerPage + idx + 1;
                  const hasLocation = printer.warehouseSpace && printer.warehouseRow && printer.warehouseRow !== 'Sin Asignar';
                  const isNewWithoutEquipmentNumber = !printer.internalNumber || String(printer.internalNumber).trim() === '';
                  const systemState = printer.systemStatus || 'Principal';

                  return (
                    <tr 
                      key={printer.id || printer.serial} 
                      className={`hover:bg-slate-50/70 transition-colors ${
                        !hasLocation ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {globalIdx}
                      </td>

                      {/* 1. CLAVE */}
                      <td className="py-3 px-4 font-bold text-slate-800">
                        {printer.material || 'MODELO GENÉRICO'}
                      </td>

                      {/* 2. NÚMERO DE SERIE */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {printer.serial}
                      </td>

                      {/* 3. NÚMERO DE EQUIPO */}
                      <td className="py-3 px-4">
                        {isNewWithoutEquipmentNumber ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md" title="Equipo nuevo registrado sin número asignado todavía. Se vinculará al subir el Excel maestro.">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                            Pendiente (Nuevo)
                          </span>
                        ) : (
                          <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            #{printer.internalNumber}
                          </span>
                        )}
                      </td>

                      {/* 4. ALMACÉN */}
                      <td className="py-3 px-4 font-medium text-slate-700">
                        {printer.warehouseName || 'Almacén 1'}
                      </td>

                      {/* 5. FILA */}
                      <td className="py-3 px-4">
                        {printer.warehouseRow && printer.warehouseRow !== 'Sin Asignar' ? (
                          <span className="font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md text-[11px]">
                            {printer.warehouseRow}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium text-[11px]">
                            Sin Asignar
                          </span>
                        )}
                      </td>

                      {/* 6. ESPACIO */}
                      <td className="py-3 px-4 font-bold text-slate-800">
                        {printer.warehouseSpace ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-md text-[11px]">
                            {printer.warehouseSpace}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">
                            Sin Espacio
                          </span>
                        )}
                      </td>

                      {/* 7. ESTADO (SISTEMA / ÁREA) */}
                      <td className="py-3 px-4">
                        {(() => {
                          let badgeClass = 'bg-blue-100 text-blue-900 border-blue-300';
                          let dotColor = 'bg-blue-500';
                          if (systemState === 'Seminuevos') {
                            badgeClass = 'bg-orange-100 text-orange-950 border-orange-300';
                            dotColor = 'bg-orange-500';
                          } else if (systemState === 'Remanufacturado') {
                            badgeClass = 'bg-emerald-100 text-emerald-950 border-emerald-300';
                            dotColor = 'bg-emerald-500';
                          } else if (systemState === 'Refacciones para operaciones') {
                            badgeClass = 'bg-amber-100 text-amber-950 border-amber-300';
                            dotColor = 'bg-amber-500';
                          }
                          return (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${badgeClass}`}>
                              <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
                              {systemState}
                            </span>
                          );
                        })()}
                      </td>

                      {/* ACCIONES */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(printer)}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1 rounded-lg text-[11px] transition border border-slate-200 shadow-2xs inline-flex items-center gap-1"
                          title="Cambiar Almacén, Fila, Espacio, Número de Equipo o Estado"
                        >
                          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PIE DE TABLA CON PAGINACIÓN */}
        {filteredPrinters.length > 0 && (
          <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-600">
            <div>
              Mostrando <strong className="text-slate-800">{paginatedPrinters.length}</strong> de <strong className="text-slate-800">{filteredPrinters.length}</strong> máquinas filtradas (Total general: {allPrinters.length})
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 font-medium"
              >
                &larr; Anterior
              </button>
              
              <span className="px-3 py-1 text-slate-700 font-semibold">
                Página {currentPage} de {totalPages}
              </span>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 font-medium"
              >
                Siguiente &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: REUBICAR / ASIGNAR UBICACIÓN CON VALIDACIÓN DE COLISIÓN */}
      {editingPrinter && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleSaveLocation}
            className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up flex flex-col gap-4 relative max-h-[90vh] overflow-y-auto"
          >
            <button 
              type="button" 
              onClick={() => setEditingPrinter(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-sm p-1"
            >
              ✕
            </button>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                Acomodo Físico
              </span>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                ¿Dónde quieres colocar esta máquina?
              </h3>
              <p className="text-xs text-slate-500">
                Define Almacén, Fila y Espacio. El sistema valida que el espacio no esté repetido en la misma fila.
              </p>
            </div>

            {/* DETALLES DE LA MÁQUINA */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">1. Clave (Modelo):</span>
                <span className="font-bold text-slate-800 truncate block mt-0.5">{editingPrinter.material}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">2. Número de Serie:</span>
                <span className="font-mono font-bold text-slate-900 block mt-0.5">{editingPrinter.serial}</span>
              </div>
            </div>

            {/* CAMPOS DE UBICACIÓN */}
            <div className="space-y-3">
              {/* ALMACÉN */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase">
                    4. Almacén:
                  </label>
                  {!showCustomWarehouse ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(true)}
                      className="text-[11px] text-blue-600 hover:underline font-medium"
                    >
                      + Nuevo Almacén
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomWarehouse(false)}
                      className="text-[11px] text-slate-400 hover:underline"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {!showCustomWarehouse ? (
                  <select
                    value={editWarehouse}
                    onChange={(e) => setEditWarehouse(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-red-500 outline-none"
                  >
                    {warehouseList.map((w, idx) => (
                      <option key={idx} value={w}>{w}</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Ej: Alpha, Beta, Almacén Central..."
                      value={customWarehouseInput}
                      onChange={(e) => setCustomWarehouseInput(e.target.value)}
                      className="flex-1 bg-slate-50 border border-blue-400 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customWarehouseInput.trim()) {
                          setEditWarehouse(customWarehouseInput.trim());
                          setShowCustomWarehouse(false);
                          setCustomWarehouseInput('');
                        }
                      }}
                      className="bg-slate-800 text-white font-medium text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* FILA */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase">
                    5. Fila:
                  </label>
                  {!showCustomRow ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomRow(true)}
                      className="text-[11px] text-blue-600 hover:underline font-medium"
                    >
                      + Nueva Fila
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCustomRow(false)}
                      className="text-[11px] text-slate-400 hover:underline"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {!showCustomRow ? (
                  <select
                    value={editRow}
                    onChange={(e) => setEditRow(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-red-500 outline-none"
                  >
                    {rowList.map((r, idx) => (
                      <option key={idx} value={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Ej: 20, 19, 22, Fila 10..."
                      value={customRowInput}
                      onChange={(e) => setCustomRowInput(e.target.value)}
                      className="flex-1 bg-slate-50 border border-blue-400 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customRowInput.trim()) {
                          setEditRow(customRowInput.trim());
                          setShowCustomRow(false);
                          setCustomRowInput('');
                        }
                      }}
                      className="bg-slate-800 text-white font-medium text-xs px-3 py-2 rounded-xl"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              {/* ESPACIO */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">
                  6. Espacio:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 19 D, 3 I, 14 D, 12, 11..."
                  value={editSpace}
                  onChange={(e) => setEditSpace(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 uppercase outline-none"
                />
              </div>

              {/* NÚMERO DE EQUIPO */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">
                  3. Número de Equipo (Opcional si es nueva):
                </label>
                <input
                  type="text"
                  placeholder="Ej: 2535, 104..."
                  value={editInternalNumber}
                  onChange={(e) => setEditInternalNumber(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                />
              </div>

              {/* 7. ESTADO DE PROCESO / SISTEMA */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 uppercase mb-1">
                  7. Estado (Área / Proceso en Sistema):
                </label>
                <select
                  value={editSystemStatus}
                  onChange={(e) => setEditSystemStatus(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none"
                >
                  <option value="Principal">🔵 Principal (Azul)</option>
                  <option value="Seminuevos">🟠 Seminuevos (Naranja)</option>
                  <option value="Remanufacturado">🟢 Remanufacturado (Verde)</option>
                  <option value="Refacciones para operaciones">🟡 Refacciones para operaciones (Amarillo)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Define el área de proceso: Principal, Seminuevos, Remanufacturado o Refacciones.
                </p>
              </div>
            </div>

            {/* ALERTA VISIBLE DE COLISIÓN DE ESPACIO */}
            {collisionOccupant && (
              <div className="bg-rose-50 border-2 border-rose-400 rounded-2xl p-3.5 text-xs text-rose-900 animate-pulse flex items-start gap-2.5">
                <svg className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-bold text-rose-900">
                    ¡Espacio Ocupado! No se puede repetir en la misma fila.
                  </p>
                  <p className="text-rose-700 mt-0.5">
                    El espacio <strong className="underline font-bold">"{editSpace}"</strong> en <strong className="font-bold">{editRow}</strong> ({editWarehouse}) ya está ocupado por la serie <strong className="font-mono">{collisionOccupant.serial}</strong> (Modelo: {collisionOccupant.material || 'N/A'}).
                  </p>
                  <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                    Por favor escribe otro espacio diferente para continuar.
                  </p>
                </div>
              </div>
            )}

            {/* BOTONES DE ACCIÓN */}
            <div className="flex gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingPrinter(null)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving || Boolean(collisionOccupant)}
                className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs text-white transition shadow-xs flex items-center justify-center gap-1.5 ${
                  collisionOccupant 
                    ? 'bg-slate-300 cursor-not-allowed' 
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isSaving ? 'Guardando...' : 'Confirmar Datos'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: CONFIRMACIÓN DE ACTUALIZACIÓN MAESTRO CON PURGA DE BAJAS */}
      {pendingUpdateData && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmUpdate}
            className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up flex flex-col gap-4 relative max-h-[90vh] overflow-y-auto"
          >
            <button 
              type="button" 
              onClick={() => {
                setPendingUpdateData(null);
                setUpdatePasswordInput('');
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-sm p-1"
            >
              ✕
            </button>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Reconciliación con Detección de Bajas
              </span>
              <h3 className="text-lg font-black text-slate-900 mt-1">
                Actualizar Inventario Maestro
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Archivo analizado: <strong className="text-slate-800">{pendingUpdateData.fileName}</strong>
              </p>
            </div>

            {/* RESUMEN DE DIFERENCIAS */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50/60 border border-blue-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] uppercase font-bold text-blue-700 block">
                  Impresoras Leídas en Archivo
                </span>
                <span className="text-2xl font-black text-blue-950 block mt-1">
                  {pendingUpdateData.extractedRows.length}
                </span>
                <span className="text-[10px] text-blue-600 mt-0.5 block">
                  Permanecerán o se actualizarán
                </span>
              </div>

              <div className="bg-rose-50/60 border border-rose-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] uppercase font-bold text-rose-700 block">
                  Impresoras No Presentes (Bajas)
                </span>
                <span className="text-2xl font-black text-rose-700 block mt-1">
                  {pendingUpdateData.removedPrinters.length}
                </span>
                <span className="text-[10px] text-rose-600 mt-0.5 block">
                  Se darán de baja del maestro
                </span>
              </div>
            </div>

            {/* LISTA DETALLADA DE BAJAS */}
            {pendingUpdateData.removedPrinters.length > 0 ? (
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-700 flex justify-between items-center">
                  <span>Equipos que causarán baja ({pendingUpdateData.removedPrinters.length})</span>
                  <span className="text-[10px] text-slate-500 font-normal">Se guardarán en el Historial de Bajas (30 días)</span>
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {pendingUpdateData.removedPrinters.map((p, idx) => (
                    <div key={idx} className="p-2.5 flex justify-between items-center hover:bg-slate-50">
                      <div>
                        <span className="font-mono font-bold text-slate-900">{p.serial}</span>
                        <span className="text-slate-500 text-[11px] ml-2">({p.material || 'Sin modelo'})</span>
                      </div>
                      <div className="text-right text-[11px]">
                        <span className="text-slate-600 font-medium">{p.warehouseName || 'Almacén 1'} - {p.warehouseRow || 'Sin Fila'}</span>
                        {p.warehouseSpace && <span className="ml-1 text-emerald-700 font-bold">[{p.warehouseSpace}]</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
                <span>✓ No se detectaron bajas. Todas las máquinas actuales coinciden con el archivo.</span>
              </div>
            )}

            {/* AUTORIZACIÓN CON CONTRASEÑA */}
            <div className="bg-amber-50/50 border border-amber-200 p-3.5 rounded-2xl">
              <label className="block text-[11px] font-bold text-amber-950 uppercase mb-1">
                Autorización de Administrador:
              </label>
              <p className="text-[11px] text-amber-800 mb-2">
                Ingresa la contraseña de autorización (<code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">QWERTY</code>) para confirmar las bajas y actualizar el inventario.
              </p>
              <input
                type="password"
                required
                placeholder="Ingresa la contraseña..."
                value={updatePasswordInput}
                onChange={(e) => setUpdatePasswordInput(e.target.value)}
                className="w-full bg-white border border-amber-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 outline-none"
              />
            </div>

            {/* BOTONES */}
            <div className="flex gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setPendingUpdateData(null);
                  setUpdatePasswordInput('');
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isExecutingUpdate}
                className="flex-1 py-2.5 px-4 rounded-xl font-bold text-xs text-white bg-red-600 hover:bg-red-700 transition shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isExecutingUpdate ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Aplicando Cambios...</span>
                  </>
                ) : (
                  <span>Confirmar y Actualizar Maestro</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: HISTORIAL DE BAJAS (30 DÍAS) */}
      {showDeparturesModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up flex flex-col gap-4 relative max-h-[90vh]">
            <button 
              type="button" 
              onClick={() => setShowDeparturesModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-sm p-1"
            >
              ✕
            </button>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  Historial de Salidas
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-1">
                  Historial de Bajas de Inventario
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Registros de los últimos 30 días (1 mes). Las bajas más antiguas se depuran automáticamente.
                </p>
              </div>

              {departuresList.length > 0 && (
                <button
                  type="button"
                  onClick={() => InventoryController.exportDeparturesReportToExcel(departuresList)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 px-3.5 rounded-xl transition flex items-center gap-1.5 shadow-2xs shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Descargar Excel</span>
                </button>
              )}
            </div>

            {/* TABLA DE BAJAS */}
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-2xl">
              {isLoadingDepartures ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-slate-300 border-t-red-600 rounded-full animate-spin"></div>
                  <span className="text-xs font-medium">Cargando bajas de los últimos 30 días...</span>
                </div>
              ) : departuresList.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <p className="font-semibold text-slate-600">No hay registros de bajas en los últimos 30 días.</p>
                  <p className="text-[11px] text-slate-400 mt-1">Cuando actualices el inventario maestro con un archivo donde falten equipos, aparecerán aquí.</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] tracking-wider sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Fecha Baja</th>
                      <th className="py-2.5 px-3">Serie</th>
                      <th className="py-2.5 px-3">Clave (Modelo)</th>
                      <th className="py-2.5 px-3">No. Equipo</th>
                      <th className="py-2.5 px-3">Ubicación Previa</th>
                      <th className="py-2.5 px-3">Estado Previo</th>
                      <th className="py-2.5 px-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {departuresList.map((dep, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-600 whitespace-nowrap">
                          {dep.departure_date ? new Date(dep.departure_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">
                          {dep.serial}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-700 truncate max-w-[120px]">
                          {dep.material || '-'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700">
                          {dep.internal_number ? `#${dep.internal_number}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {dep.warehouse_name || '-'} {dep.warehouse_row ? `/ ${dep.warehouse_row}` : ''} {dep.warehouse_space ? `[${dep.warehouse_space}]` : ''}
                        </td>
                        <td className="py-2 px-3">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {dep.system_status || 'Principal'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-500 italic">
                          {dep.reason || 'Baja por actualización de maestro'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-xs text-slate-500">
              <span>Total de bajas registradas: <strong className="text-slate-800">{departuresList.length}</strong></span>
              <button
                type="button"
                onClick={() => setShowDeparturesModal(false)}
                className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

