import { useState, useRef, useMemo } from 'react';
import { extractSeriesFromExcel } from '../utils/excelParser';
import { extractSeriesFromPDF } from '../utils/pdfParser';
import { InventoryController } from '../controllers/InventoryController.js';
import WarehouseMapView from './WarehouseMapView.jsx';

export default function HomeView({ 
  batches = [], 
  onCreateBatch, 
  onSelectBatch, 
  onDeleteBatch,
  onNavigateToModelSearch,
  onStatusChange,
  onLayoutChange
}) {
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  // Modal para que el operador coloque obligatoriamente el consecutivo manual
  const [pendingUploadData, setPendingUploadData] = useState(null);
  const [manualConsecutiveInput, setManualConsecutiveInput] = useState('');

  // Buscador por modelo en la pantalla principal
  const [quickModelQuery, setQuickModelQuery] = useState('');

  const fileInputRef = useRef(null);

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
    const trimmed = manualConsecutiveInput.trim();
    if (!trimmed) {
      alert("Por favor ingresa el número consecutivo de inventario para este checklist.");
      return;
    }

    onCreateBatch(pendingUploadData.fileName, pendingUploadData.series, trimmed);
    setPendingUploadData(null);
  };

  return (
    <div className="flex flex-col flex-1 gap-6 animate-fade-in w-full pb-16">
      
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

        {/* Botón: Subir Documento */}
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
              {isProcessingFile ? 'Leyendo documento...' : 'Subir Documento (Excel / PDF)'}
            </span>
            <span className="text-xs text-slate-500 block mt-0.5 font-normal">
              Asignación manual de consecutivo
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

      {/* CONTENEDOR PRINCIPAL: 2 COLUMNAS EN PANTALLA COMPLETA (IZQUIERDA: OPERACIÓN / DERECHA: MAPA) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">
        
        {/* COLUMNA IZQUIERDA: BUSCADOR POR MODELO Y LISTA DE CHECKLISTS */}
        <div className="lg:col-span-6 flex flex-col gap-6 w-full">
          
          {/* BUSCADOR POR MODELO (CONSULTA / BAJA) */}
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
                              {printer.warehouseRow}
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

          {/* LISTA DE CHECKLISTS REGISTRADOS (CONTROL DE INVENTARIO) */}
          <div className="w-full bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Checklists Registrados
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Selecciona un lote para escanear
                  </p>
                </div>
              </div>
              <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full border border-slate-200">
                {batches.length} {batches.length === 1 ? 'lote' : 'lotes'}
              </span>
            </div>

            {batches.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-600 font-medium text-xs">No hay checklists registrados todavía.</p>
                <p className="text-[11px] text-slate-400 mt-1">Sube un archivo Excel o PDF arriba para comenzar.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map((batch) => {
                  const isFinished = batch.isCompleted;
                  const pendingCount = batch.pendingCount;

                  const modelsInBatch = Array.from(
                    new Set(batch.expectedSeries.map(s => s.material).filter(Boolean))
                  ).slice(0, 2).join(', ');

                  return (
                    <div key={batch.id} className="flex gap-2 items-center">
                      <button 
                        onClick={() => onSelectBatch(batch.id)}
                        className={`flex-1 flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-xl border transition-all text-left gap-2 ${
                          isFinished 
                            ? 'bg-emerald-50/30 border-emerald-200 hover:border-emerald-300' 
                            : 'bg-white border-slate-200 hover:border-red-400 hover:shadow-xs'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="bg-red-600 text-white font-bold text-xs px-2.5 py-1 rounded-lg uppercase tracking-wide shrink-0">
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
                            {isFinished ? (
                              <span className="text-[11px] font-medium text-emerald-800 bg-emerald-100/70 border border-emerald-200 px-2 py-0.5 rounded-md">
                                Completado ({batch.totalCount})
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                                Faltan: {pendingCount} de {batch.totalCount}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 text-xs">&rarr;</span>
                        </div>
                      </button>

                      <button 
                        onClick={() => onDeleteBatch(batch.id)}
                        className="p-2.5 bg-white rounded-xl border border-slate-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 text-slate-400 transition-colors"
                        title="Eliminar Checklist"
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

      {/* MODAL OBLIGATORIO: EL OPERADOR REGISTRA MANUALMENTE EL NÚMERO CONSECUTIVO */}
      {pendingUploadData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-fade-in-up"
          >
            <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 text-center">
              Registrar Consecutivo de Inventario
            </h3>
            <p className="text-xs text-slate-500 text-center mt-1">
              Documento: <span className="font-semibold text-slate-700">{pendingUploadData.fileName}</span> ({pendingUploadData.series.length} series detectadas).
            </p>

            <div className="my-5 bg-slate-50 border border-slate-200 p-4 rounded-xl">
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">
                Número Consecutivo de Checklist (Ingreso Manual):
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="EJ: 001, 105, 2026-A..."
                value={manualConsecutiveInput}
                onChange={(e) => setManualConsecutiveInput(e.target.value)}
                className="w-full border border-slate-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 rounded-xl px-3 py-2 text-center text-base font-bold text-slate-800 uppercase"
              />
              <p className="text-[11px] text-slate-400 mt-2 text-center">
                El operador ingresa la numeración de manejo de inventario.
              </p>
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
    </div>
  );
}
