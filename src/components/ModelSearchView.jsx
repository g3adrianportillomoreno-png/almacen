import { useState, useMemo } from 'react';
import { InventoryController } from '../controllers/InventoryController';
import { PrinterModel } from '../models/PrinterModel';

export default function ModelSearchView({ 
  checklists, 
  onStatusChange, 
  onRowChange,
  availableRows = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Fila 5', 'Fila 6']
}) {
  const [modelQuery, setModelQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedPrinterForBaja, setSelectedPrinterForBaja] = useState(null);

  // Extraer todas las impresoras de todos los lotes
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(checklists);
  }, [checklists]);

  // Modelos únicos para sugerencias rápidas
  const uniqueModels = useMemo(() => {
    return InventoryController.getUniqueModels(allPrinters);
  }, [allPrinters]);

  // Impresoras filtradas por el buscador y estado
  const filteredPrinters = useMemo(() => {
    return InventoryController.filterPrinters(allPrinters, modelQuery, statusFilter);
  }, [allPrinters, modelQuery, statusFilter]);

  // Contadores generales
  const stats = useMemo(() => {
    const total = allPrinters.length;
    const consultas = allPrinters.filter(p => p.isConsulta).length;
    const bajas = allPrinters.filter(p => p.isBaja).length;
    const disponibles = allPrinters.filter(p => p.isDisponible).length;
    return { total, consultas, bajas, disponibles };
  }, [allPrinters]);

  const handleMarkConsulta = async (serial) => {
    await InventoryController.markAsConsulta(serial);
    if (onStatusChange) onStatusChange();
  };

  const handleConfirmBaja = async (serial) => {
    await InventoryController.markAsBaja(serial);
    setSelectedPrinterForBaja(null);
    if (onStatusChange) onStatusChange();
  };

  const handleResetDisponible = async (serial) => {
    await InventoryController.resetToDisponible(serial);
    if (onStatusChange) onStatusChange();
  };

  const handleRowSelect = async (serial, newRow) => {
    await InventoryController.changeRow(serial, newRow);
    if (onRowChange) onRowChange();
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto animate-fade-in pb-12">
      {/* Encabezado del buscador */}
      <div className="bg-white p-6 rounded-2xl shadow-xs border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              Buscador por Modelo de Impresora
            </h2>
            <p className="text-slate-500 text-xs mt-1">
              Consulta unidades por modelo, asigna fila y gestiona su estado en <span className="font-semibold text-amber-700">Consulta</span> o <span className="font-semibold text-rose-600">Baja</span>.
            </p>
          </div>

          {/* Tarjetas de estadísticas */}
          <div className="flex gap-2">
            <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">Total</span>
              <span className="text-base font-bold text-slate-700">{stats.total}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="block text-[10px] text-emerald-700 font-medium uppercase tracking-wider">Almacén</span>
              <span className="text-base font-bold text-emerald-700">{stats.disponibles}</span>
            </div>
            <div className="bg-amber-50/60 border border-amber-200 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="block text-[10px] text-amber-800 font-medium uppercase tracking-wider">Consulta</span>
              <span className="text-base font-bold text-amber-800">{stats.consultas}</span>
            </div>
            <div className="bg-rose-50/60 border border-rose-200 px-3 py-1.5 rounded-xl text-center min-w-[70px]">
              <span className="block text-[10px] text-rose-700 font-medium uppercase tracking-wider">Baja</span>
              <span className="text-base font-bold text-rose-700">{stats.bajas}</span>
            </div>
          </div>
        </div>

        {/* Input de búsqueda principal */}
        <div className="relative">
          <input
            type="text"
            className="w-full border border-slate-300 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl px-4 py-2.5 pl-10 text-sm text-slate-800 placeholder-slate-400 font-medium transition-all uppercase"
            placeholder="ESCRIBE EL MODELO DE LA IMPRESORA O NÚMERO DE SERIE..."
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          {modelQuery && (
            <button 
              onClick={() => setModelQuery('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs bg-slate-100 rounded-full w-5 h-5 flex items-center justify-center transition"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sugerencias de modelos detectados */}
        {uniqueModels.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium uppercase mr-1">Sugerencias:</span>
            {uniqueModels.map((m, idx) => (
              <button
                key={idx}
                onClick={() => setModelQuery(m)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  modelQuery.toUpperCase() === m.toUpperCase()
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Pestañas de filtro por estado */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'ALL'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({allPrinters.length})
          </button>
          <button
            onClick={() => setStatusFilter(PrinterModel.STATUS_DISPONIBLE)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === PrinterModel.STATUS_DISPONIBLE
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            En Almacén ({stats.disponibles})
          </button>
          <button
            onClick={() => setStatusFilter(PrinterModel.STATUS_CONSULTA)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === PrinterModel.STATUS_CONSULTA
                ? 'bg-amber-500 text-slate-900 shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            En Consulta ({stats.consultas})
          </button>
          <button
            onClick={() => setStatusFilter(PrinterModel.STATUS_BAJA)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === PrinterModel.STATUS_BAJA
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Dadas de Baja ({stats.bajas})
          </button>
        </div>
      </div>

      {/* Resultados de búsqueda */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center px-1">
          <p className="text-xs font-medium text-slate-500">
            Mostrando <span className="font-semibold text-slate-700">{filteredPrinters.length}</span> impresora(s)
          </p>
        </div>

        {filteredPrinters.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-slate-300 text-center flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">No se encontraron impresoras</p>
            <p className="text-xs text-slate-500 max-w-sm">
              Intenta con otro modelo o limpia el filtro de búsqueda para ver todos los equipos.
            </p>
            {modelQuery && (
              <button
                onClick={() => setModelQuery('')}
                className="mt-1 text-xs bg-slate-100 text-slate-700 font-medium px-3 py-1.5 rounded-lg hover:bg-slate-200 transition"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filteredPrinters.map((printer) => {
              const badge = printer.getStatusBadge();

              return (
                <div
                  key={printer.id || printer.serial}
                  className={`p-4 rounded-xl border transition-all shadow-xs ${badge.cardBorder} flex flex-col md:flex-row md:items-center justify-between gap-4`}
                >
                  {/* Información Principal de la Impresora */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      {printer.internalNumber && (
                        <span className="bg-slate-700 text-white font-bold text-xs px-2 py-0.5 rounded-md">
                          #{printer.internalNumber}
                        </span>
                      )}
                      <span className="font-mono text-base font-bold text-slate-800 tracking-wide">
                        {printer.serial}
                      </span>

                      {/* Badge de estado */}
                      <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${badge.badgeClass} flex items-center gap-1.5`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor}`}></span>
                        {badge.label}
                      </span>

                      {printer.isScanned && (
                        <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                          Escaneada
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mt-2">
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium uppercase block">Modelo</span>
                        <span className="font-semibold text-slate-700 truncate block">{printer.material}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium uppercase block">Ubicación</span>
                        <select
                          value={printer.warehouseRow}
                          onChange={(e) => handleRowSelect(printer.serial, e.target.value)}
                          className="bg-white border border-slate-300 font-medium text-slate-700 text-xs rounded-lg px-2 py-0.5 mt-0.5 focus:border-blue-500 focus:outline-none"
                        >
                          {availableRows.map((rowName, rIdx) => (
                            <option key={rIdx} value={rowName}>{rowName}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium uppercase block">Lote / Folio</span>
                        <span className="font-normal text-slate-600 truncate block">
                          <span className="font-semibold text-slate-700">{printer.checklistFolio || 'SIN FOLIO'}</span> {printer.checklistName ? `| ${printer.checklistName}` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Explicación contextual de estado si está en consulta o baja */}
                    {printer.isConsulta && (
                      <div className="mt-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                        <span><strong>Estado de Consulta:</strong> Esta impresora se encuentra en otra área o en proceso de verificación técnica.</span>
                      </div>
                    )}
                    {printer.isBaja && (
                      <div className="mt-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                        <span><strong>Baja confirmada:</strong> Unidad retirada del almacén. No disponible para despacho.</span>
                      </div>
                    )}
                  </div>

                  {/* Botones de acción: CONSULTA y BAJA */}
                  <div className="flex md:flex-col gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                    {/* Botón CONSULTA */}
                    <button
                      onClick={() => handleMarkConsulta(printer.serial)}
                      disabled={printer.isConsulta}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                        printer.isConsulta
                          ? 'bg-amber-400 text-slate-900 font-semibold cursor-default'
                          : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 shadow-2xs'
                      }`}
                      title="Marcar como CONSULTA (verificando en otra área)"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      {printer.isConsulta ? 'En Consulta' : 'Consulta'}
                    </button>

                    {/* Botón BAJA */}
                    <button
                      onClick={() => setSelectedPrinterForBaja(printer)}
                      disabled={printer.isBaja}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                        printer.isBaja
                          ? 'bg-rose-700 text-white font-semibold cursor-default'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 shadow-2xs'
                      }`}
                      title="Dar de baja la impresora"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      {printer.isBaja ? 'Dada de Baja' : 'Dar de Baja'}
                    </button>

                    {/* Botón Restablecer si no está en almacén */}
                    {!printer.isDisponible && (
                      <button
                        onClick={() => handleResetDisponible(printer.serial)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition border border-slate-200 text-center"
                      >
                        Regresar a Almacén
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Confirmación de BAJA */}
      {selectedPrinterForBaja && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-fade-in-up">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 text-center">
              Confirmar BAJA de Impresora
            </h3>
            <p className="text-xs text-slate-500 text-center mt-1">
              ¿Confirmar que la siguiente unidad sale definitivamente del almacén?
            </p>

            <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl my-4 text-xs">
              <p className="text-slate-400 font-medium uppercase text-[10px]">Número de Serie:</p>
              <p className="font-mono text-sm font-bold text-slate-800 mt-0.5">{selectedPrinterForBaja.serial}</p>
              <p className="text-slate-400 font-medium uppercase text-[10px] mt-2">Modelo:</p>
              <p className="font-semibold text-slate-700 mt-0.5">{selectedPrinterForBaja.material}</p>
              <p className="text-slate-400 font-medium uppercase text-[10px] mt-2">Fila Actual:</p>
              <p className="font-semibold text-blue-700 mt-0.5">{selectedPrinterForBaja.warehouseRow}</p>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setSelectedPrinterForBaja(null)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleConfirmBaja(selectedPrinterForBaja.serial)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition shadow-xs"
              >
                Confirmar Baja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
