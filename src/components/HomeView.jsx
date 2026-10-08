import { useState, useRef, useMemo } from 'react';
import { extractSeriesFromExcel } from '../utils/excelParser';
import { extractSeriesFromPDF } from '../utils/pdfParser';
import { InventoryController } from '../controllers/InventoryController.js';
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
  onStatusChange,
  onLayoutChange
}) {
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Modal para que el operador coloque obligatoriamente el consecutivo manual y contraseña de autorización
  const [pendingUploadData, setPendingUploadData] = useState(null);
  const [manualConsecutiveInput, setManualConsecutiveInput] = useState('');
  const [uploadPasswordInput, setUploadPasswordInput] = useState('');

  // Modal de seguridad para borrar lote con contraseña
  const [deleteModalBatch, setDeleteModalBatch] = useState(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');

  // Buscador por modelo en la pantalla principal
  const [quickModelQuery, setQuickModelQuery] = useState('');

  const fileInputRef = useRef(null);

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

  // Checklists pendientes / disponibles para escanear
  const pendingBatches = useMemo(() => {
    return batches.filter(b => b.status !== 'completed' && b.completed.length < b.expectedSeries.length);
  }, [batches]);

  // Checklists 100% completados para depurar del historial sin perder impresoras
  const completedBatches = useMemo(() => {
    return batches.filter(b => {
      const total = b.totalCount || b.expectedSeries.length;
      return (total > 0 && b.completed.length >= total) || (b.status === 'completed' && b.expectedSeries.length === 0);
    });
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

  // Subida de Excel o PDF
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessingFile(true);

    try {
      let extractedSeries = [];
      
      if (file.name.toLowerCase().endsWith('.pdf')) {
        extractedSeries = await extractSeriesFromPDF(file);
      } else {
        extractedSeries = await extractSeriesFromExcel(file);
      }
      
      if (extractedSeries.length === 0) {
        alert("No se encontraron números de serie. Verifica el formato del documento.");
        setIsProcessingFile(false);
        return;
      }

      setManualConsecutiveInput('');
      setUploadPasswordInput('');
      setPendingUploadData({
        fileName: file.name,
        series: extractedSeries
      });
    } catch (error) {
      alert("Error al procesar el documento: " + error.message);
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmCreateBatch = (e) => {
    e.preventDefault();
    if (!pendingUploadData) return;

    if (uploadPasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. Se requiere autorización para subir documentos.");
      return;
    }

    const trimmedConsecutive = manualConsecutiveInput.trim();
    if (!trimmedConsecutive) {
      alert("Por favor ingresa el número consecutivo de inventario para este checklist.");
      return;
    }

    onCreateBatch(pendingUploadData.fileName, pendingUploadData.series, trimmedConsecutive);
    setPendingUploadData(null);
    setManualConsecutiveInput('');
    setUploadPasswordInput('');
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

        {onNavigateToMasterInventory && (
          <button
            type="button"
            onClick={onNavigateToMasterInventory}
            className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shrink-0"
          >
            <span>Ir al Inventario Maestro</span>
            <span>&rarr;</span>
          </button>
        )}
      </div>

      {/* FILA SUPERIOR: SUBIR DOCUMENTO, ESTADO DE CHECKLIST Y RESUMEN RÁPIDO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
        {/* Input invisible para el archivo */}
        <input 
          type="file" 
          accept=".pdf, .xlsx, .xls, .csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
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
              {isProcessingFile ? 'Leyendo documento...' : 'Subir Checklist de Recepción'}
            </span>
            <span className="text-xs text-slate-500 block mt-0.5 font-normal">
              Asignar consecutivo para escaneo físico
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

              <div className="flex items-center gap-2">
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
                  {batches.length} {batches.length === 1 ? 'lote' : 'lotes'}
                </span>
              </div>
            </div>

            {batches.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-600 font-medium text-xs">No hay checklists registrados todavía.</p>
                <p className="text-[11px] text-slate-400 mt-1">Sube un archivo Excel o PDF arriba para comenzar.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map((batch) => {
                  const total = batch.totalCount || batch.expectedSeries.length;
                  const completedCount = batch.completed.length;
                  const pendingCount = batch.pendingCount;

                  const isFullCompleted = total > 0 && completedCount >= total;
                  const isClosedWithPending = (batch.status === 'completed' || batch.status === 'closed') && completedCount < total;

                  const modelsInBatch = Array.from(
                    new Set(batch.expectedSeries.map(s => s.material).filter(Boolean))
                  ).slice(0, 2).join(', ');

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

      {/* MODAL OBLIGATORIO: CONSECUTIVO MANUAL Y CONTRASEÑA QWERTY AL SUBIR DOCUMENTO */}
      {pendingUploadData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-fade-in-up flex flex-col gap-4"
          >
            <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
            </div>
            
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">
                Registrar Consecutivo de Inventario
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Documento: <span className="font-semibold text-slate-700">{pendingUploadData.fileName}</span>
              </p>
            </div>

            {/* AVISO DESTACADO DE IMPRESORAS DETECTADAS */}
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 rounded-xl text-center flex items-center justify-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-semibold">
                Se detectaron <strong className="text-sm font-bold text-emerald-700">{pendingUploadData.series.length} impresoras</strong> en el documento.
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Número Consecutivo de Checklist (Ingreso Manual):
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="EJ: 001, 105, 2026-A..."
                  value={manualConsecutiveInput}
                  onChange={(e) => setManualConsecutiveInput(e.target.value)}
                  className="w-full border border-slate-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 rounded-xl px-3 py-2 text-center text-sm font-bold text-slate-800 uppercase"
                />
              </div>

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
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs transition shadow-xs"
              >
                Guardar Checklist
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
