import { useState, useRef, useMemo } from 'react';
import { extractMercadoLibreData } from '../utils/mercadolibreExcelParser.js';
import { MercadoLibreController } from '../controllers/MercadoLibreController.js';

export default function MercadoLibreView({
  batches = [],
  onCreateBatch,
  onSelectBatch,
  onDeleteBatch,
  onRefresh
}) {
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileError, setFileError] = useState(null);

  // Modal para autorizar subida con consecutivo manual y contraseña
  const [pendingUploadData, setPendingUploadData] = useState(null);
  const [manualConsecutiveInput, setManualConsecutiveInput] = useState('');
  const [uploadPasswordInput, setUploadPasswordInput] = useState('');

  // Modal de seguridad para eliminar lote
  const [deleteModalBatch, setDeleteModalBatch] = useState(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');

  // Buscador de lotes por folio, nombre o guía
  const [searchQuery, setSearchQuery] = useState('');

  const fileInputRef = useRef(null);

  // Siguiente consecutivo sugerido
  const nextConsecutiveSuggested = useMemo(() => {
    return MercadoLibreController.getNextConsecutive(batches);
  }, [batches]);

  // Totales globales
  const stats = useMemo(() => {
    let totalItems = 0;
    let totalScanned = 0;
    batches.forEach(b => {
      totalItems += b.totalCount || b.items.length;
      totalScanned += b.scannedCount || b.items.filter(i => i.isScanned).length;
    });
    const totalPending = Math.max(0, totalItems - totalScanned);
    return {
      batchesCount: batches.length,
      totalItems,
      totalScanned,
      totalPending
    };
  }, [batches]);

  // Lotes filtrados
  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(b => {
      const matchFolio = (b.folio || '').toLowerCase().includes(q);
      const matchName = (b.name || '').toLowerCase().includes(q);
      const matchItem = (b.items || []).some(
        it => (it.guideNumber || '').toLowerCase().includes(q) || (it.trackingNumber || '').toLowerCase().includes(q)
      );
      return matchFolio || matchName || matchItem;
    });
  }, [batches, searchQuery]);

  // Procesar archivo seleccionado
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessingFile(true);
    setFileError(null);

    try {
      const parsed = await extractMercadoLibreData(file);

      if (!parsed.items || parsed.items.length === 0) {
        throw new Error('No se encontraron registros de guía y rastreo en el documento.');
      }

      setManualConsecutiveInput(String(nextConsecutiveSuggested));
      setUploadPasswordInput('');
      setPendingUploadData({
        fileName: file.name,
        items: parsed.items
      });
    } catch (err) {
      setFileError(err.message || 'Error procesando archivo.');
      alert("Error en el archivo de Mercado Libre: " + err.message);
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Confirmar creación del lote
  const handleConfirmCreateBatch = async (e) => {
    e.preventDefault();
    if (!pendingUploadData) return;

    if (uploadPasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. Se requiere autorización (QWERTY) para registrar este lote.");
      return;
    }

    const trimmedConsecutive = manualConsecutiveInput.trim();
    if (!trimmedConsecutive) {
      alert("Por favor indica el consecutivo para este lote.");
      return;
    }

    try {
      await onCreateBatch(pendingUploadData.fileName, pendingUploadData.items, trimmedConsecutive);
      setPendingUploadData(null);
      setManualConsecutiveInput('');
      setUploadPasswordInput('');
    } catch (err) {
      alert("Error al guardar el lote: " + err.message);
    }
  };

  // Confirmar eliminación
  const handleConfirmDelete = async (e) => {
    e.preventDefault();
    if (!deleteModalBatch) return;

    if (deletePasswordInput.trim() !== 'QWERTY') {
      alert("Contraseña incorrecta. No se puede eliminar el lote.");
      return;
    }

    try {
      await onDeleteBatch(deleteModalBatch.id);
      setDeleteModalBatch(null);
      setDeletePasswordInput('');
    } catch (err) {
      alert("Error al eliminar el lote: " + err.message);
    }
  };

  return (
    <div className="flex flex-col flex-1 gap-6 animate-fade-in w-full pb-16">
      
      {/* CABECERA EXPLICATIVA DE MERCADO LIBRE */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-amber-200/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-amber-50/50 via-white to-white">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-400 text-amber-950 flex items-center justify-center font-black text-xl shadow-xs shrink-0 border border-amber-300">
            📦
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                Módulo Mercado Libre
              </h2>
              <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Despacho y Guías
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              Sube archivos con las columnas <strong className="text-slate-900">Número de guía</strong> y <strong className="text-slate-900">Número de rastreo</strong>. Escanea los paquetes con pistola o cámara y audita las salidas en Excel.
            </p>
          </div>
        </div>

        {/* Input oculto para archivo Excel/CSV */}
        <input 
          type="file" 
          accept=".xlsx, .xls, .csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessingFile}
          className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs transition shadow-xs flex items-center gap-2 shrink-0 border border-amber-400 cursor-pointer"
        >
          {isProcessingFile ? (
            <div className="w-4 h-4 border-2 border-amber-950 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <svg className="w-4 h-4 text-amber-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
            </svg>
          )}
          <span>Subir Archivo de Mercado Libre</span>
        </button>
      </div>

      {/* TARJETAS DE ESTADÍSTICAS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Lotes Activos</span>
          <span className="text-2xl font-black text-slate-800 mt-1 block">{stats.batchesCount}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Total Paquetes</span>
          <span className="text-2xl font-black text-blue-600 mt-1 block">{stats.totalItems}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-2xs bg-emerald-50/20">
          <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">Escaneados</span>
          <span className="text-2xl font-black text-emerald-600 mt-1 block">{stats.totalScanned}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-100 shadow-2xs bg-amber-50/20">
          <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">Faltantes</span>
          <span className="text-2xl font-black text-amber-600 mt-1 block">{stats.totalPending}</span>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y LISTA DE LOTES */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Lotes de Despacho Registrados</h3>
            <p className="text-xs text-slate-500">Haz clic en cualquier lote para iniciar o continuar la toma de lectura.</p>
          </div>
          <div className="w-full sm:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por Folio, archivo, guía..."
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-amber-400 bg-slate-50 focus:bg-white transition"
            />
          </div>
        </div>

        {/* LISTADO DE LOTES */}
        {filteredBatches.length === 0 ? (
          <div className="py-12 px-4 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl mb-3">
              📦
            </div>
            <p className="text-sm font-bold text-slate-700">No hay lotes de Mercado Libre que mostrar</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Sube un archivo de Excel o CSV con las columnas <strong className="text-slate-700">Número de guía</strong> y <strong className="text-slate-700">Número de rastreo</strong> para comenzar a escanear.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-4 py-2 bg-amber-400 hover:bg-amber-300 text-amber-950 font-bold text-xs rounded-xl shadow-xs transition"
            >
              Subir Archivo Ahora
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filteredBatches.map(batch => {
              const total = batch.totalCount || batch.items.length;
              const scanned = batch.scannedCount || batch.items.filter(i => i.isScanned).length;
              const pending = Math.max(0, total - scanned);
              const isCompleted = total > 0 && scanned >= total;
              const percent = batch.progressPercentage || (total > 0 ? Math.round((scanned / total) * 100) : 0);

              return (
                <div
                  key={batch.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                    isCompleted
                      ? 'bg-emerald-50/30 border-emerald-200 hover:border-emerald-300'
                      : 'bg-white border-slate-200 hover:border-amber-400 shadow-2xs hover:shadow-xs'
                  }`}
                >
                  {/* Información Principal del Lote */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-sm shrink-0 border ${
                      isCompleted 
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs' 
                        : 'bg-amber-400 text-amber-950 border-amber-300 shadow-xs'
                    }`}>
                      {batch.folio || 'ML'}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-800 truncate">
                          {batch.cleanName || batch.name}
                        </h4>
                        {isCompleted && (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-300">
                            ✓ 100% Completo
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                        <span>📅 {batch.date || 'Hoy'}</span>
                        <span>•</span>
                        <span>📦 Total: <strong className="text-slate-700">{total}</strong> guías</span>
                        <span>•</span>
                        <span className="text-emerald-700 font-semibold">✓ {scanned} leídas</span>
                        {pending > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-700 font-semibold">⏳ {pending} faltantes</span>
                          </>
                        )}
                      </div>

                      {/* Barra de Progreso */}
                      <div className="w-full max-w-md bg-slate-100 h-2 rounded-full overflow-hidden mt-2.5 border border-slate-200">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCompleted ? 'bg-emerald-500' : 'bg-amber-400'
                          }`}
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {/* Botones de Acción */}
                  <div className="flex items-center gap-2 w-full md:w-auto justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                    {/* Botón Descargar Reporte Excel */}
                    <button
                      type="button"
                      onClick={() => MercadoLibreController.exportBatchReportToExcel(batch)}
                      className="px-3 py-2 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition flex items-center gap-1.5"
                      title="Descargar Reporte en Excel (4 Hojas)"
                    >
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>Reporte Excel</span>
                    </button>

                    {/* Botón Iniciar / Continuar Escaneo */}
                    <button
                      type="button"
                      onClick={() => onSelectBatch(batch.id)}
                      className={`px-3.5 py-2 font-bold text-xs rounded-xl transition shadow-xs flex items-center gap-1.5 ${
                        isCompleted
                          ? 'bg-slate-800 hover:bg-slate-900 text-white'
                          : 'bg-amber-400 hover:bg-amber-300 text-amber-950 border border-amber-400'
                      }`}
                    >
                      <span>{isCompleted ? 'Ver Lecturas' : 'Escanear Paquetes'}</span>
                      <span>&rarr;</span>
                    </button>

                    {/* Botón Eliminar Lote */}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteModalBatch(batch);
                        setDeletePasswordInput('');
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
                      title="Eliminar este lote de Mercado Libre"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DE CONFIRMACIÓN DE SUBIDA */}
      {pendingUploadData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmCreateBatch}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up"
          >
            <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center text-2xl mb-4 border border-amber-300">
              📦
            </div>
            
            <h3 className="text-base font-bold text-slate-800">
              Nuevo Lote de Mercado Libre
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Se detectaron <strong className="text-slate-800 font-bold">{pendingUploadData.items.length}</strong> paquetes con Número de Guía y Número de Rastreo.
            </p>

            <div className="my-4 bg-amber-50/60 border border-amber-200 rounded-xl p-3 text-xs text-slate-700 flex flex-col gap-1">
              <div><span className="text-slate-400 font-semibold">Archivo:</span> <span className="font-mono font-medium">{pendingUploadData.fileName}</span></div>
              <div><span className="text-slate-400 font-semibold">Total Guías:</span> <strong className="text-amber-900">{pendingUploadData.items.length} paquetes</strong></div>
            </div>

            <div className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Consecutivo del Lote (Folio):
                </label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2 bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-600">
                    ML-
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={manualConsecutiveInput}
                    onChange={(e) => setManualConsecutiveInput(e.target.value)}
                    required
                    placeholder="1"
                    className="flex-1 px-3 py-2 text-sm font-bold border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Contraseña de Autorización (QWERTY):
                </label>
                <input
                  type="password"
                  value={uploadPasswordInput}
                  onChange={(e) => setUploadPasswordInput(e.target.value)}
                  required
                  placeholder="Introduce la contraseña"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => {
                  setPendingUploadData(null);
                  setManualConsecutiveInput('');
                  setUploadPasswordInput('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs transition shadow-xs border border-amber-400"
              >
                Crear Lote
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE ELIMINACIÓN */}
      {deleteModalBatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleConfirmDelete}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up"
          >
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center text-2xl mb-4">
              🗑️
            </div>

            <h3 className="text-base font-bold text-slate-900">
              ¿Eliminar Lote de Mercado Libre?
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Estás a punto de eliminar el lote <strong className="text-slate-900">{deleteModalBatch.folio}</strong> ({deleteModalBatch.cleanName || deleteModalBatch.name}) con sus {deleteModalBatch.totalCount || deleteModalBatch.items.length} paquetes.
            </p>

            <div className="my-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Contraseña de Confirmación (QWERTY):
              </label>
              <input
                type="password"
                value={deletePasswordInput}
                onChange={(e) => setDeletePasswordInput(e.target.value)}
                required
                placeholder="Introduce QWERTY para confirmar"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalBatch(null);
                  setDeletePasswordInput('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition shadow-xs"
              >
                Eliminar Permanentemente
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}

