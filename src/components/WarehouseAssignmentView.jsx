import { useState, useMemo, useRef, useEffect } from 'react';
import { InventoryController } from '../controllers/InventoryController.js';
import { WarehouseMapController } from '../controllers/WarehouseMapController.js';
import { extractSeriesFromExcel } from '../utils/excelParser.js';
import CameraScanner from './CameraScanner.jsx';

export default function WarehouseAssignmentView({ 
  checklists = [], 
  onCreateBatch,
  onAssignmentSaved,
  availableWarehouses = ['Almacén 1', 'Almacén 2'],
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4'],
  onNavigateToAssignment,
  onBackToHome,
  fullScreenMode = false
}) {
  const [scanInput, setScanInput] = useState('');
  const [activePrinter, setActivePrinter] = useState(null);
  const [notFoundQuery, setNotFoundQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(fullScreenMode);

  // Subida de Excel directamente dentro de la pantalla
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const fileInputRef = useRef(null);

  // Formulario de asignación
  const [selectedWarehouse, setSelectedWarehouse] = useState(availableWarehouses[0] || 'Almacén 1');
  const [selectedRow, setSelectedRow] = useState(availableRows[0] || 'Fila 1');
  const [spaceInput, setSpaceInput] = useState('');
  const [internalNumberInput, setInternalNumberInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scanInputRef = useRef(null);

  // Si está en modo pantalla completa, activar la cámara automáticamente
  useEffect(() => {
    if (fullScreenMode) {
      setIsCameraActive(true);
    }
  }, [fullScreenMode]);

  // Extraer todas las impresoras de todos los lotes
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(checklists);
  }, [checklists]);

  // Contadores
  const stats = useMemo(() => {
    const total = allPrinters.length;
    const asignados = allPrinters.filter(p => p.warehouseSpace || p.isScanned).length;
    const faltantes = total - asignados;
    return { total, asignados, faltantes };
  }, [allPrinters]);

  // Subir archivo Excel directamente dentro de esta pantalla
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploadingExcel(true);
    try {
      const extracted = await extractSeriesFromExcel(file);
      if (extracted.length === 0) {
        alert("No se encontraron series en el archivo. Verifica que contenga la columna 'NUMERO DE SERIE' o 'SERIE'.");
        setIsUploadingExcel(false);
        return;
      }

      if (onCreateBatch) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        await onCreateBatch(file.name, extracted, cleanName);
      }

      setSuccessMessage(`¡Archivo "${file.name}" cargado! Se detectaron ${extracted.length} impresoras con CLAVE, NUMERO DE SERIE y NUMERO DE EQUIPO.`);
      if (onAssignmentSaved) onAssignmentSaved();
    } catch (err) {
      alert("Error al leer el archivo Excel: " + err.message);
    } finally {
      setIsUploadingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Manejo de búsqueda por pistola / lector / código
  const handleSearchSerial = (rawSerial) => {
    const serial = (rawSerial || '').trim().toUpperCase();
    if (!serial) return;

    setSuccessMessage('');
    setNotFoundQuery('');

    // Buscar en todas las impresoras registradas en los documentos cargados
    const match = allPrinters.find(p => p.serial === serial);

    if (match) {
      setActivePrinter(match);
      setNotFoundQuery('');
      setSelectedWarehouse(match.warehouseName || availableWarehouses[0] || 'Almacén 1');
      setSelectedRow(match.warehouseRow || availableRows[0] || 'Fila 1');
      setSpaceInput(match.warehouseSpace || '');
      setInternalNumberInput(match.internalNumber !== null && match.internalNumber !== undefined ? String(match.internalNumber) : '');
    } else {
      setActivePrinter(null);
      setNotFoundQuery(serial);
    }
    setScanInput('');
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchSerial(scanInput);
    }
  };

  const handleCameraScan = (scannedCode) => {
    handleSearchSerial(scannedCode);
  };

  // Guardar asignación
  const handleSaveAssignment = async (e) => {
    e.preventDefault();
    if (!activePrinter) return;

    setIsSubmitting(true);
    try {
      const spaceVal = spaceInput.trim() || 'General';
      const numEquipo = internalNumberInput.trim() !== '' ? internalNumberInput.trim() : activePrinter.internalNumber;

      await InventoryController.assignPrinter(activePrinter.serial, {
        warehouseName: selectedWarehouse,
        warehouseRow: selectedRow,
        warehouseSpace: spaceVal,
        internalNumber: numEquipo
      });

      // Asegurar que la fila se cree en el plano del mapa si es nueva
      if (selectedRow) {
        WarehouseMapController.ensureRowExists(selectedRow, selectedWarehouse);
      }

      setSuccessMessage(`¡Serie ${activePrinter.serial} guardada en ${selectedWarehouse} → ${selectedRow} → ${spaceVal}!`);
      
      // Sugerir siguiente espacio si es numérico (ej: 1 -> 2)
      const numMatch = spaceVal.match(/^.*?(\d+)$/);
      if (numMatch) {
        const nextNum = parseInt(numMatch[1], 10) + 1;
        const prefix = spaceVal.replace(/\d+$/, '');
        setSpaceInput(`${prefix}${nextNum}`);
      } else {
        setSpaceInput('');
      }

      setActivePrinter(null);
      if (onAssignmentSaved) onAssignmentSaved();

      // Devolver foco al input para la siguiente pistola
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 100);
    } catch (err) {
      alert("Error al guardar asignación: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Descarga del reporte Excel con columnas exactas: CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO, ALMACEN, FILA, ESPACIO
  const handleExportExcel = () => {
    InventoryController.exportInventoryReportToExcel(allPrinters);
  };

  // VISTA PANTALLA COMPLETA DEDICADA
  if (fullScreenMode) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-fade-in pb-16">
        {/* Input invisible para subir Excel dentro de esta pantalla */}
        <input 
          type="file" 
          accept=".xlsx, .xls, .csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
        />

        {/* Cabecera superior de la pantalla de asignación */}
        <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Pantalla de Captura y Asignación
                </h2>
                <p className="text-xs text-slate-500">
                  Sube tu Excel o captura serie con cámara (zoom y linterna) / pistola para asignar Almacén, Fila y Espacio.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Botón Subir Archivo Excel directamente aquí */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingExcel}
              className={`text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-2xs ${isUploadingExcel ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Cargar archivo Excel con CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO"
            >
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {isUploadingExcel ? 'Cargando Excel...' : 'Subir Archivo Excel'}
            </button>

            {/* Botón Descargar Excel */}
            <button
              onClick={handleExportExcel}
              className="text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-2xs"
              title="Descargar Excel con CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO, ALMACEN, FILA, ESPACIO"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Descargar Excel
            </button>

            {onBackToHome && (
              <button
                onClick={onBackToHome}
                className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3 py-2 rounded-xl transition flex items-center gap-1"
              >
                &larr; Volver
              </button>
            )}
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs text-center">
          <div>
            <span className="block text-[11px] text-slate-400 font-medium uppercase tracking-wider">Total en Archivo</span>
            <span className="text-lg font-bold text-slate-800">{stats.total}</span>
          </div>
          <div className="border-x border-slate-200">
            <span className="block text-[11px] text-emerald-700 font-medium uppercase tracking-wider">Equipos Asignados</span>
            <span className="text-lg font-bold text-emerald-700">{stats.asignados}</span>
          </div>
          <div>
            <span className="block text-[11px] text-amber-800 font-medium uppercase tracking-wider">Faltan por Asignar</span>
            <span className="text-lg font-bold text-amber-800">{stats.faltantes}</span>
          </div>
        </div>

        {/* CÁMARA CON LINTERNA Y ZOOM INTEGRADA DIRECTAMENTE */}
        {isCameraActive && (
          <div className="bg-slate-900 rounded-3xl p-4 shadow-md flex flex-col items-center">
            <div className="flex justify-between items-center w-full max-w-sm mb-2 text-xs text-slate-300">
              <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Cámara Activa (Zoom y Linterna)
              </span>
              <button 
                onClick={() => setIsCameraActive(false)}
                className="text-slate-400 hover:text-white underline text-xs"
              >
                Ocultar Cámara
              </button>
            </div>

            <CameraScanner
              expectedSeries={allPrinters}
              onScan={handleCameraScan}
              onCancel={() => setIsCameraActive(false)}
            />
          </div>
        )}

        {!isCameraActive && (
          <div className="text-center py-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <button
              onClick={() => setIsCameraActive(true)}
              className="bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs px-5 py-2.5 rounded-xl transition flex items-center gap-2 mx-auto shadow-xs"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Encender Cámara (Linterna y Zoom)
            </button>
          </div>
        )}

        {/* Input manual / pistola */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              ref={scanInputRef}
              type="text"
              className="w-full border border-slate-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 rounded-xl px-4 py-2.5 pl-10 text-xs uppercase font-medium text-slate-800 placeholder-slate-400"
              placeholder="DISPARA LA PISTOLA AQUÍ O ESCRIBE EL NÚMERO DE SERIE..."
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => handleSearchSerial(scanInput)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium px-5 py-2.5 rounded-xl transition shadow-xs"
          >
            Buscar Serie
          </button>
        </div>

        {/* Mensaje de éxito */}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-3.5 rounded-xl text-xs font-medium flex items-center gap-2 animate-fade-in shadow-2xs">
            <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Alerta de no encontrada */}
        {notFoundQuery && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 p-4 rounded-xl text-xs font-medium flex items-start gap-2.5 animate-fade-in">
            <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-bold">La serie "{notFoundQuery}" no coincide con ningún documento cargado.</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Usa el botón "Subir Archivo Excel" arriba para cargar el documento correspondiente.</p>
            </div>
          </div>
        )}

        {/* INFORMACIÓN DEL EQUIPO DETECTADO Y FORMULARIO DE ALMACÉN, FILA Y ESPACIO */}
        {activePrinter && (
          <form onSubmit={handleSaveAssignment} className="bg-white border-2 border-emerald-500 rounded-3xl p-6 shadow-lg flex flex-col gap-4 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-sm font-bold text-slate-800">Información del Equipo en el Documento:</span>
              </div>
              <button 
                type="button" 
                onClick={() => setActivePrinter(null)}
                className="text-xs text-slate-400 hover:text-slate-600 p-1"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* LAS 3 COLUMNAS BASE: CLAVE, NUMERO DE SERIE, NUMERO DE EQUIPO */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">1. CLAVE (Modelo):</span>
                <span className="font-bold text-slate-800 text-sm truncate block mt-0.5">{activePrinter.material}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">2. NUMERO DE SERIE:</span>
                <span className="font-mono font-bold text-slate-900 text-sm truncate block mt-0.5">{activePrinter.serial}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">3. NUMERO DE EQUIPO:</span>
                <span className="font-bold text-emerald-800 text-sm truncate block mt-0.5">
                  {activePrinter.internalNumber ? `#${activePrinter.internalNumber}` : 'Sin Asignar'}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5 truncate">{activePrinter.checklistFolio}</span>
              </div>
            </div>

            {/* LAS 3 COLUMNAS A ASIGNAR POR EL OPERADOR: ALMACEN, FILA, ESPACIO */}
            <div className="pt-1">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">
                Completar Acomodo en Almacén:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* 4. ALMACEN */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    4. ALMACÉN:
                  </label>
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none"
                  >
                    {availableWarehouses.map((w, idx) => (
                      <option key={idx} value={w}>{w}</option>
                    ))}
                  </select>
                </div>

                {/* 5. FILA */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    5. FILA:
                  </label>
                  <select
                    value={selectedRow}
                    onChange={(e) => setSelectedRow(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none"
                  >
                    {availableRows.map((r, idx) => (
                      <option key={idx} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                {/* 6. ESPACIO */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    6. ESPACIO:
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="EJ: ESPACIO 1, E-05, POS 14..."
                    value={spaceInput}
                    onChange={(e) => setSpaceInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 uppercase focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Edición opcional de Número de Equipo */}
            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <label className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                Editar No. de Equipo (si aplica):
              </label>
              <input
                type="text"
                placeholder="Ej: 1, 105, 2026..."
                value={internalNumberInput}
                onChange={(e) => setInternalNumberInput(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 w-28 uppercase focus:border-emerald-600 focus:outline-none"
              />
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActivePrinter(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 transition shadow-md flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                {isSubmitting ? 'Guardando...' : 'Confirmar y Asignar Acomodo'}
              </button>
            </div>
          </form>
        )}

        {/* Botón inferior de retorno */}
        {onBackToHome && (
          <div className="text-center pt-2">
            <button
              onClick={onBackToHome}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 underline"
            >
              &larr; Volver al Menú Principal
            </button>
          </div>
        )}
      </div>
    );
  }

  // BOTÓN SIMPLE SI SE RENDERIZA EN OTRA PARTE
  return (
    <div className="w-full bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
      <button
        type="button"
        onClick={onNavigateToAssignment}
        className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium p-4 rounded-xl transition flex items-center justify-between shadow-xs group cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-700 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="text-left">
            <span className="text-sm font-bold block text-white">
              Asignación y Acomodo en Almacén
            </span>
            <span className="text-xs text-slate-300 block font-normal">
              Subir Excel, capturar con cámara (zoom/linterna) o pistola y descargar Excel
            </span>
          </div>
        </div>
        <span className="text-slate-300 group-hover:text-white group-hover:translate-x-1 transition-transform text-sm">&rarr;</span>
      </button>
    </div>
  );
}
