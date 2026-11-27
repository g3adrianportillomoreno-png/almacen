// src/components/ConsumiblesView.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { ConsumiblesController } from '../controllers/ConsumiblesController.js';
import { ConsumiblesRepository } from '../services/ConsumiblesRepository.js';
import { soundEffects } from '../utils/soundEffects.js';

export default function ConsumiblesView() {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedSeccion, setSelectedSeccion] = useState('ALL');
  const [selectedStockStatus, setSelectedStockStatus] = useState('ALL');
  
  // Producto escaneado / seleccionado para mostrar en el Banner Principal
  const [highlightedItem, setHighlightedItem] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [notification, setNotification] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingBarcodes, setIsUploadingBarcodes] = useState(false);

  // Modal para editar consumible
  const [editingItem, setEditingItem] = useState(null);

  // Paginación para carga rápida (50 registros por página por defecto)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const scanInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const barcodeFileInputRef = useRef(null);
  const tableContainerRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const items = await ConsumiblesController.loadCatalog();
      setCatalog(items || []);
      if (items && items.length > 0 && !highlightedItem) {
        setHighlightedItem(items[0]);
      }
    } catch (e) {
      console.error('Error cargando consumibles:', e);
      showToast('error', 'Error al cargar el catálogo de consumibles.');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (type, text) => {
    setNotification({ type, text });
    setTimeout(() => {
      setNotification(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Listas de filtros únicos
  const availableCategories = useMemo(() => {
    const set = new Set();
    catalog.forEach(it => {
      if (it.categoria) set.add(it.categoria);
    });
    return Array.from(set).sort();
  }, [catalog]);

  const availableSecciones = useMemo(() => {
    const set = new Set();
    catalog.forEach(it => {
      if (it.seccion) set.add(it.seccion);
    });
    return Array.from(set).sort();
  }, [catalog]);

  // Estadísticas globales
  const stats = useMemo(() => {
    let totalStock = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let withLocationCount = 0;

    catalog.forEach(it => {
      const exist = Number(it.existencias) || 0;
      totalStock += exist;
      const min = Number(it.stock_min) || 0;
      if (exist <= 0) outOfStockCount++;
      else if (min > 0 && exist <= min) lowStockCount++;
      if (it.seccion || it.anaquel || it.espacio) withLocationCount++;
    });

    return {
      totalItems: catalog.length,
      totalStock,
      lowStockCount,
      outOfStockCount,
      withLocationCount
    };
  }, [catalog]);

  // Filtrado de la tabla
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter(it => {
      if (selectedCategory !== 'ALL' && it.categoria !== selectedCategory) return false;
      if (selectedSeccion !== 'ALL' && it.seccion !== selectedSeccion) return false;

      const stockStatus = ConsumiblesController.getStockStatus(it);
      if (selectedStockStatus === 'OUT' && stockStatus.status !== 'OUT_OF_STOCK') return false;
      if (selectedStockStatus === 'LOW' && stockStatus.status !== 'LOW_STOCK') return false;
      if (selectedStockStatus === 'NORMAL' && stockStatus.status !== 'NORMAL') return false;

      if (!q) return true;
      const clave = String(it.clave || '').toLowerCase();
      const nombre = String(it.nombre || '').toLowerCase();
      const cat = String(it.categoria || '').toLowerCase();
      const sec = String(it.seccion || '').toLowerCase();
      const anaq = String(it.anaquel || '').toLowerCase();
      const esp = String(it.espacio || '').toLowerCase();
      const barcodes = Array.isArray(it.barcodes) ? it.barcodes.join(' ').toLowerCase() : '';

      return (
        clave.includes(q) ||
        nombre.includes(q) ||
        cat.includes(q) ||
        sec.includes(q) ||
        anaq.includes(q) ||
        esp.includes(q) ||
        barcodes.includes(q)
      );
    });
  }, [catalog, searchQuery, selectedCategory, selectedSeccion, selectedStockStatus]);

  // Reiniciar a página 1 al cambiar búsqueda, filtros o tamaño de página
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, selectedSeccion, selectedStockStatus, pageSize]);

  // Cálculo de paginación (solo renderiza 50 filas por vez para máxima velocidad)
  const totalPages = Math.max(1, Math.ceil(filteredCatalog.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedCatalog = useMemo(() => {
    return filteredCatalog.slice(startIndex, startIndex + pageSize);
  }, [filteredCatalog, startIndex, pageSize]);

  const goToPage = (page) => {
    const target = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(target);
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Manejador de escaneo rápido / búsqueda por código de barras
  const handleScanSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;

    const { match, candidates, matchedByBarcode } = ConsumiblesController.findMatch(scanInput, catalog);
    if (match) {
      soundEffects.playScanSuccess();
      setHighlightedItem(match);
      const barcodeNote = matchedByBarcode ? ` (por código de barras ${scanInput.trim()})` : '';
      showToast('success', `✓ Encontrado: ${match.clave}${barcodeNote} - Ubicación: ${match.seccion || 'N/A'} [${match.anaquel || 'N/A'}]`);
      setScanInput('');
    } else {
      soundEffects.playScanError();
      const codeToLink = scanInput.trim();
      const confirmLink = window.confirm(
        `El código "${codeToLink}" no está registrado todavía.\n\n¿Deseas vincularlo ahora a un consumible existente (ej. IK03847)?`
      );
      if (confirmLink) {
        const targetClave = window.prompt(`Introduce la clave del consumible a vincular con "${codeToLink}" (ej. IK03847):`);
        if (targetClave && targetClave.trim()) {
          ConsumiblesController.linkBarcode(codeToLink, targetClave.trim()).then(updated => {
            if (updated) {
              setCatalog(prev => prev.map(c => c.id === updated.id ? updated : c));
              setHighlightedItem(updated);
              showToast('success', `✓ ¡Código ${codeToLink} vinculado permanentemente a ${updated.clave}!`);
            } else {
              showToast('error', `No se encontró ningún consumible con clave "${targetClave}".`);
            }
          });
        }
      }
      setScanInput('');
    }
  };

  // Subir y procesar archivo Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmReplace = window.confirm(
      `¿Deseas importar el archivo "${file.name}" para actualizar el catálogo de consumibles?`
    );
    if (!confirmReplace) {
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      const updated = await ConsumiblesController.importExcel(file);
      setCatalog(updated);
      if (updated.length > 0) setHighlightedItem(updated[0]);
      soundEffects.playScanSuccess();
      showToast('success', `✓ ¡Catálogo actualizado con éxito! Se cargaron ${updated.length} consumibles.`);
    } catch (err) {
      console.error('Error importando Excel de consumibles:', err);
      soundEffects.playScanError();
      showToast('error', `Error al importar: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Subir archivo Excel o CSV masivo para vincular Códigos de Barras / UPC con Claves
  const handleBarcodesFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingBarcodes(true);
    try {
      const result = await ConsumiblesController.importBarcodesExcel(file);
      setCatalog(result.updatedCatalog);
      soundEffects.playScanSuccess();
      const extraNote = result.unmatchedCodes.length > 0
        ? ` (${result.unmatchedCodes.length} claves nuevas guardadas en alias para futuras recepciones)`
        : '';
      showToast(
        'success',
        `✓ ¡Códigos vinculados! ${result.linkedInCatalog} productos actualizados en catálogo y ${result.savedAliases} códigos guardados en la nube.${extraNote}`
      );
    } catch (err) {
      console.error('Error importando códigos de barras:', err);
      soundEffects.playScanError();
      showToast('error', `Error al subir códigos de barras: ${err.message}`);
    } finally {
      setIsUploadingBarcodes(false);
      e.target.value = '';
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      const original = catalog.find(it => String(it.id) === String(editingItem.id));
      const prevSeccion = original?.seccion || '';
      const prevAnaquel = original?.anaquel || '';
      const prevEspacio = original?.espacio || '';
      const prevAlmacen = original?.almacen || 'Principal';

      const newSeccion = editingItem.seccion || '';
      const newAnaquel = editingItem.anaquel || '';
      const newEspacio = editingItem.espacio || '';
      const newAlmacen = editingItem.almacen || 'Principal';

      const wasLocationChanged = (
        prevSeccion.trim().toUpperCase() !== newSeccion.trim().toUpperCase() ||
        prevAnaquel.trim().toUpperCase() !== newAnaquel.trim().toUpperCase() ||
        prevEspacio.trim().toUpperCase() !== newEspacio.trim().toUpperCase() ||
        prevAlmacen.trim().toUpperCase() !== newAlmacen.trim().toUpperCase()
      );

      let itemToSave = { ...editingItem };
      if (wasLocationChanged) {
        itemToSave.locationStatus = 'RELOCATED';
        itemToSave.previousLocation = {
          seccion: prevSeccion,
          anaquel: prevAnaquel,
          espacio: prevEspacio,
          almacen: prevAlmacen
        };
        itemToSave.lastVerifiedAt = new Date().toISOString();
        itemToSave.verifiedBy = 'Administrador / Almacén';

        // Registrar en el historial permanente de movimientos
        const prevStr = `${prevSeccion} [${prevAnaquel} - ${prevEspacio}]`.trim() || 'Sin Asignar';
        const newStr = `${newSeccion} [${newAnaquel} - ${newEspacio}]`.trim() || 'Sin Asignar';

        ConsumiblesRepository.recordLocationMovement({
          timestamp: itemToSave.lastVerifiedAt,
          dateFormatted: new Date().toLocaleString('es-MX', { hour12: true }),
          clave: editingItem.clave,
          description: editingItem.nombre || '',
          barcode: Array.isArray(editingItem.barcodes) ? editingItem.barcodes.join(', ') : '',
          prevLocation: prevStr,
          newLocation: newStr,
          movementType: 'REUBICACIÓN',
          operator: 'Administrador / Almacén',
          batchFolio: 'CATÁLOGO MAESTRO'
        });
      }

      const updated = await ConsumiblesController.updateItem(editingItem.id, itemToSave);
      setCatalog(updated);
      setHighlightedItem(itemToSave);
      setEditingItem(null);
      if (wasLocationChanged) {
        showToast('warning', `⚠️ ¡Ubicación cambiada a ${newSeccion} [${newAnaquel} - ${newEspacio}]! Registrada en Movimientos y marcada amarillo en Excel.`);
      } else {
        showToast('success', '✓ Consumible actualizado correctamente.');
      }
    } catch (err) {
      showToast('error', 'Error al guardar cambios.');
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-12 animate-in fade-in duration-150">
      
      {/* AVISO / TOAST FLOTANTE */}
      {notification && (
        <div className={`p-3 rounded-xl text-xs font-bold text-center shadow-lg transition-all ${
          notification.type === 'success'
            ? 'bg-emerald-600 text-white'
            : notification.type === 'error'
              ? 'bg-rose-600 text-white'
              : 'bg-amber-500 text-slate-900'
        }`}>
          {notification.text}
        </div>
      )}

      {/* ENCABEZADO Y ACCIONES PRINCIPALES */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📦</span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Control de Consumibles y Refacciones
            </h1>
            <span className="bg-red-100 text-red-800 text-[11px] font-black px-2.5 py-0.5 rounded-full border border-red-200 uppercase tracking-wider">
              {catalog.length} Productos
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Consulta rápida de ubicación física (Sección, Anaquel, Espacio) y validación de existencias en tiempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Input oculto para subir archivo de catálogo completo */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Input oculto para subir archivo masivo de Códigos de Barras / UPC */}
          <input
            ref={barcodeFileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleBarcodesFileUpload}
            className="hidden"
          />

          <button
            type="button"
            disabled={isUploadingBarcodes}
            onClick={() => barcodeFileInputRef.current?.click()}
            className="flex-1 sm:flex-none bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600/30 font-black text-xs px-3.5 py-2.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Subir Excel o CSV con columnas 'Codigo' y 'Codigo de barras / UPC' para vincular códigos masivamente sin tocar existencias"
          >
            <span>🔗</span>
            <span>{isUploadingBarcodes ? 'Vinculando...' : 'Subir Códigos de Barras'}</span>
          </button>

          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 sm:flex-none bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs px-3.5 py-2.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Subir archivo Excel oficial con las columnas Clave, Nombre, Existencias, Ubicación..."
          >
            <span>📁</span>
            <span>{isUploading ? 'Importando...' : 'Cargar / Actualizar Excel'}</span>
          </button>

          <button
            type="button"
            onClick={() => ConsumiblesController.exportExcel(filteredCatalog)}
            className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
            title="Descargar lista filtrada de consumibles en Excel"
          >
            <span>📥</span>
            <span>Exportar Excel</span>
          </button>
        </div>
      </div>

      {/* TARJETAS DE ESTADÍSTICAS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold">
            🏷️
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase">Total Productos</div>
            <div className="text-lg sm:text-xl font-black text-slate-800">{stats.totalItems.toLocaleString()}</div>
          </div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg font-bold">
            📦
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase">Existencias Totales</div>
            <div className="text-lg sm:text-xl font-black text-emerald-700">{stats.totalStock.toLocaleString()} pzas</div>
          </div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-lg font-bold">
            ⚠️
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase">Stock Bajo / Mínimo</div>
            <div className="text-lg sm:text-xl font-black text-amber-700">{stats.lowStockCount}</div>
          </div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-lg font-bold">
            📍
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase">Con Ubicación</div>
            <div className="text-lg sm:text-xl font-black text-purple-700">{stats.withLocationCount}</div>
          </div>
        </div>
      </div>

      {/* BARRA DE ESCANEO RÁPIDO CON PISTOLA O TECLADO */}
      <div className="bg-gradient-to-r from-red-800 via-rose-800 to-slate-900 rounded-2xl p-4 sm:p-5 text-white shadow-md">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          <label className="text-xs font-black tracking-wide text-rose-200 flex items-center gap-1.5 uppercase">
            <span>🔫</span>
            <span>Escanear Código de Barras o Escribir Clave de Consumible</span>
          </label>
          <form onSubmit={handleScanSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={scanInputRef}
                type="text"
                autoComplete="off"
                placeholder="Escanea aquí con la pistola lectora o escribe la clave (ej. C-TN227BK, 16295, 105A)..."
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                className="w-full bg-white text-slate-900 placeholder:text-slate-400 border-2 border-rose-300 focus:border-rose-400 rounded-xl px-4 py-3 text-sm font-bold font-mono outline-none shadow-inner"
              />
              {scanInput && (
                <button
                  type="button"
                  onClick={() => setScanInput('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              className="bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs sm:text-sm px-5 py-3 rounded-xl transition shadow-md flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <span>🔍</span>
              <span className="hidden sm:inline">Consultar Ubicación</span>
            </button>
          </form>
        </div>
      </div>

      {/* TARJETA DESTACADA: UBICACIÓN Y EXISTENCIAS DEL PRODUCTO SELECCIONADO */}
      {highlightedItem && (
        <div className="bg-white rounded-2xl border-2 border-red-500/40 p-4 sm:p-6 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">
            Resultado en Pantalla
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
            {/* Columna Izquierda: Datos del Producto */}
            <div className="lg:col-span-5 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-slate-900 text-white font-mono font-black text-sm px-3 py-1 rounded-lg">
                  {highlightedItem.clave}
                </span>
                <span className="bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold px-2.5 py-0.5 rounded-md">
                  {highlightedItem.categoria || 'Sin Categoría'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                {highlightedItem.nombre}
              </h2>
              <div className="text-xs text-slate-500 flex items-center gap-3">
                <span>Almacén: <strong className="text-slate-700">{highlightedItem.almacen || 'Principal'}</strong></span>
                {highlightedItem.zona && (
                  <span>Zona: <strong className="text-slate-700">{highlightedItem.zona}</strong></span>
                )}
              </div>

              {/* Códigos de barras vinculados */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase">Códigos vinculados:</span>
                {Array.isArray(highlightedItem.barcodes) && highlightedItem.barcodes.length > 0 ? (
                  highlightedItem.barcodes.map(b => (
                    <span key={b} className="bg-amber-100 text-amber-900 border border-amber-300 font-mono text-[11px] font-bold px-2 py-0.5 rounded">
                      {b}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">Ningún código adicional</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const code = window.prompt(`Ingresa o escanea el código de barras para "${highlightedItem.clave}":`);
                    if (code && code.trim()) {
                      ConsumiblesController.linkBarcode(code.trim(), highlightedItem.id).then(updated => {
                        if (updated) {
                          setCatalog(prev => prev.map(c => c.id === updated.id ? updated : c));
                          setHighlightedItem(updated);
                          showToast('success', `✓ Código ${code.trim()} vinculado a ${updated.clave}`);
                        }
                      });
                    }
                  }}
                  className="text-[11px] text-amber-700 hover:text-amber-800 font-bold underline cursor-pointer ml-1"
                >
                  + Vincular código
                </button>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...highlightedItem })}
                  className="text-xs text-red-700 hover:text-red-800 font-bold underline flex items-center gap-1 mt-1 cursor-pointer"
                >
                  ✏️ Editar ubicación o existencias
                </button>
              </div>
            </div>

            {/* Columna Centro: UBICACIÓN FÍSICA GIGANTE */}
            <div className="lg:col-span-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-4 sm:p-5 flex flex-col justify-center shadow-inner border border-slate-700">
              <div className="text-[11px] font-black tracking-wider text-red-400 uppercase flex items-center gap-1.5 mb-1">
                <span>📍</span>
                <span>Ubicación Física en Almacén</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2 text-center mt-2">
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Sección</div>
                  <div className="text-base sm:text-lg font-black text-emerald-400 truncate">
                    {highlightedItem.seccion || 'N/A'}
                  </div>
                </div>

                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Anaquel</div>
                  <div className="text-base sm:text-lg font-black text-amber-400 truncate">
                    {highlightedItem.anaquel || 'N/A'}
                  </div>
                </div>

                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Espacio</div>
                  <div className="text-base sm:text-lg font-black text-cyan-400 truncate">
                    {highlightedItem.espacio || 'N/A'}
                  </div>
                </div>
              </div>

              {(!highlightedItem.seccion && !highlightedItem.anaquel && !highlightedItem.espacio) && (
                <div className="mt-2 text-center text-xs text-rose-300 font-semibold bg-rose-950/60 p-2 rounded-lg border border-rose-800/50">
                  ⚠️ Este consumible aún no tiene ubicación asignada en anaqueles.
                </div>
              )}
            </div>

            {/* Columna Derecha: EXISTENCIAS Y STOCK */}
            <div className="lg:col-span-3 bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-center items-center text-center">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Existencias Actuales
              </div>
              <div className="text-3xl sm:text-4xl font-black text-slate-900 my-1 font-mono">
                {highlightedItem.existencias ?? 0}
              </div>
              <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${
                ConsumiblesController.getStockStatus(highlightedItem).badgeClass
              }`}>
                {ConsumiblesController.getStockStatus(highlightedItem).label}
              </span>

              <div className="flex items-center justify-center gap-4 mt-3 text-[11px] text-slate-500 font-semibold">
                <span>Mín: <strong className="text-slate-700">{highlightedItem.stock_min || 0}</strong></span>
                <span>•</span>
                <span>Máx: <strong className="text-slate-700">{highlightedItem.stock_max || 0}</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TABLA PRINCIPAL DE DATOS CON FILTROS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
        
        {/* BARRA DE HERRAMIENTAS Y FILTROS */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Buscador reactivo */}
            <div className="relative min-w-[220px] flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                🔍
              </span>
              <input
                type="text"
                placeholder="Buscar por clave, nombre, anaquel, sección..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 focus:border-red-600 rounded-xl text-xs font-semibold text-slate-800 outline-none"
              />
            </div>

            {/* Filtro por Sección */}
            {availableSecciones.length > 0 && (
              <select
                value={selectedSeccion}
                onChange={(e) => setSelectedSeccion(e.target.value)}
                className="py-2 px-3 bg-white border border-slate-300 focus:border-red-600 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                <option value="ALL">Todas las Secciones ({availableSecciones.length})</option>
                {availableSecciones.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {/* Filtro por Categoría */}
            {availableCategories.length > 0 && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="py-2 px-3 bg-white border border-slate-300 focus:border-red-600 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                <option value="ALL">Todas las Categorías ({availableCategories.length})</option>
                {availableCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* Filtro de Stock */}
            <select
              value={selectedStockStatus}
              onChange={(e) => setSelectedStockStatus(e.target.value)}
              className="py-2 px-3 bg-white border border-slate-300 focus:border-red-600 rounded-xl text-xs font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Todos los Estados</option>
              <option value="OUT">Solo Agotados (0 existencias)</option>
              <option value="LOW">Solo Stock Bajo</option>
              <option value="NORMAL">Stock Normal</option>
            </select>
          </div>

          <div className="text-xs text-slate-500 font-semibold shrink-0 flex items-center gap-2">
            <span>
              Mostrando{' '}
              <strong>
                {filteredCatalog.length === 0
                  ? 0
                  : `${startIndex + 1}–${Math.min(startIndex + pageSize, filteredCatalog.length)}`}
              </strong>{' '}
              de <strong>{filteredCatalog.length}</strong>
              {filteredCatalog.length !== catalog.length ? ` (${catalog.length} total)` : ' consumibles'}
            </span>
          </div>
        </div>

        {/* TABLA CON HOJA DE DATOS */}
        <div ref={tableContainerRef} className="overflow-x-auto overflow-y-auto max-h-[600px]">
          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <div className="w-10 h-10 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-xs font-bold">Cargando base de datos de consumibles...</p>
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <span className="text-3xl">🔍</span>
              <p className="text-xs font-bold mt-2">No se encontraron consumibles con los filtros aplicados.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold text-[11px] uppercase tracking-wider sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-12 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[140px]">Clave / Código</th>
                  <th className="py-2.5 px-3 min-w-[280px]">Nombre / Descripción</th>
                  <th className="py-2.5 px-3 min-w-[140px]">Categoría</th>
                  <th className="py-2.5 px-3 min-w-[110px] text-center">Existencias</th>
                  <th className="py-2.5 px-3 min-w-[110px]">Sección</th>
                  <th className="py-2.5 px-3 min-w-[100px]">Anaquel</th>
                  <th className="py-2.5 px-3 min-w-[90px]">Espacio</th>
                  <th className="py-2.5 px-3 min-w-[100px]">Almacén</th>
                  <th className="py-2.5 px-3 w-20 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {paginatedCatalog.map((item, idx) => {
                  const stockStatus = ConsumiblesController.getStockStatus(item);
                  const isHighlighted = highlightedItem?.id === item.id;

                  return (
                    <tr
                      key={item.id || (startIndex + idx)}
                      onClick={() => setHighlightedItem(item)}
                      className={`cursor-pointer transition-colors ${
                        isHighlighted 
                          ? 'bg-red-50/80 font-semibold' 
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {startIndex + idx + 1}
                      </td>

                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900 select-all">
                        <div>{item.clave}</div>
                        {Array.isArray(item.barcodes) && item.barcodes.length > 0 && (
                          <div className="text-[10px] text-amber-700 font-normal">
                            🔗 {item.barcodes[0]}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-slate-800 font-medium truncate max-w-sm" title={item.nombre}>
                        {item.nombre}
                      </td>

                      <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                          {item.categoria || 'Sin Categoría'}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center font-mono font-bold">
                        <span className={`px-2 py-0.5 rounded text-[11px] border ${stockStatus.badgeClass}`}>
                          {item.existencias ?? 0}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {item.seccion ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded">
                            {item.seccion}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {item.anaquel ? (
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                            {item.anaquel}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-semibold text-slate-700">
                        {item.espacio ? (
                          <span className="bg-cyan-50 text-cyan-800 border border-cyan-200 px-2 py-0.5 rounded">
                            {item.espacio}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                        {item.almacen || 'Principal'}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem({ ...item });
                          }}
                          className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded transition cursor-pointer"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* BARRA DE PAGINACIÓN INFERIOR */}
        {!loading && filteredCatalog.length > 0 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600 font-medium">
              <span>Filas por página:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-red-500 cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50 (Recomendado)</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => goToPage(1)}
                disabled={safeCurrentPage <= 1}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Primera página"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => goToPage(safeCurrentPage - 1)}
                disabled={safeCurrentPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                ‹ Anterior
              </button>

              <span className="px-3 py-1.5 font-mono font-bold text-slate-700 bg-white border border-slate-200 rounded-lg">
                Página {safeCurrentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => goToPage(safeCurrentPage + 1)}
                disabled={safeCurrentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                Siguiente ›
              </button>
              <button
                type="button"
                onClick={() => goToPage(totalPages)}
                disabled={safeCurrentPage >= totalPages}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                title="Última página"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL DE EDICIÓN RÁPIDA DE CONSUMIBLE */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold text-sm">Editar Consumible: {editingItem.clave}</h3>
              <button onClick={() => setEditingItem(null)} className="text-white/70 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 flex flex-col gap-3 text-xs">
              <div>
                <label className="font-bold text-slate-700">Nombre / Descripción:</label>
                <input
                  type="text"
                  value={editingItem.nombre || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, nombre: e.target.value })}
                  className="w-full mt-1 p-2 border border-slate-300 rounded-lg outline-none font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700">Existencias Actuales:</label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.existencias ?? 0}
                    onChange={(e) => setEditingItem({ ...editingItem, existencias: Number(e.target.value) || 0 })}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-lg outline-none font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Categoría:</label>
                  <input
                    type="text"
                    value={editingItem.categoria || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, categoria: e.target.value })}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-lg outline-none"
                  />
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col gap-2">
                <span className="font-black text-slate-700 text-[11px] uppercase">Ubicación Física:</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Sección:</label>
                    <input
                      type="text"
                      placeholder="ej. DELTA"
                      value={editingItem.seccion || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, seccion: e.target.value.toUpperCase() })}
                      className="w-full mt-0.5 p-1.5 border border-slate-300 rounded-lg font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Anaquel:</label>
                    <input
                      type="text"
                      placeholder="ej. A02"
                      value={editingItem.anaquel || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, anaquel: e.target.value.toUpperCase() })}
                      className="w-full mt-0.5 p-1.5 border border-slate-300 rounded-lg font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500">Espacio:</label>
                    <input
                      type="text"
                      placeholder="ej. 01"
                      value={editingItem.espacio || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, espacio: e.target.value.toUpperCase() })}
                      className="w-full mt-0.5 p-1.5 border border-slate-300 rounded-lg font-bold"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700">Stock Mínimo:</label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.stock_min ?? 0}
                    onChange={(e) => setEditingItem({ ...editingItem, stock_min: Number(e.target.value) || 0 })}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Stock Máximo:</label>
                  <input
                    type="number"
                    min="0"
                    value={editingItem.stock_max ?? 0}
                    onChange={(e) => setEditingItem({ ...editingItem, stock_max: Number(e.target.value) || 0 })}
                    className="w-full mt-1 p-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl shadow-xs"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
