import { useState, useRef, useEffect, useMemo } from 'react';
import { findSerialMatch, cleanSerialCore } from '../utils/serialMatcher.js';

export default function UniversalSearchBar({
  printers = [],
  onLocateEquipment,
  onUnlocatedSelected,
  placeholder = "¿Dónde está este equipo? (Serie, # o Modelo)...",
  compact = false,
  className = ""
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Escuchar atajo global de teclado (Ctrl+K o Cmd+K) para enfocar rápidamente el buscador
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cerrar desplegable al hacer clic fuera del componente
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtrado y coincidencia inteligente de equipos
  const searchResults = useMemo(() => {
    const q = (query || '').trim();
    if (!q || !printers || printers.length === 0) return [];

    const qUpper = q.toUpperCase();
    const qLower = q.toLowerCase();
    const qClean = cleanSerialCore(q);
    const qNum = parseInt(q.replace(/\D/g, ''), 10);
    const isPureNumber = /^\d+$/.test(q);

    // 1. Coincidencia inteligente de serie por serialMatcher (ceros, puntos, prefijos)
    const exactSerialMatch = findSerialMatch(q, printers, p => p.serial);

    const matches = [];
    const seenSerials = new Set();

    if (exactSerialMatch) {
      seenSerials.add(exactSerialMatch.serial.toUpperCase());
      matches.push({ ...exactSerialMatch, matchScore: 100, matchReason: 'Serie coincidente' });
    }

    // 2. Escaneo del inventario para coincidencias adicionales
    for (const p of printers) {
      const s = (p.serial || '').toUpperCase();
      if (seenSerials.has(s)) continue;

      const pInternal = p.internalNumber !== null && p.internalNumber !== undefined ? String(p.internalNumber) : '';
      const pMaterial = (p.material || '').toLowerCase();
      const pSpace = (p.warehouseSpace || '').toLowerCase();
      const pRow = (p.warehouseRow || '').toLowerCase();

      // Número interno exacto (ej: "15" o "#15")
      if (!isNaN(qNum) && pInternal && Number(pInternal) === qNum) {
        seenSerials.add(s);
        matches.push({ ...p, matchScore: 90, matchReason: `Equipo #${pInternal}` });
        continue;
      }

      // Serie contiene el texto buscado
      if (s.includes(qUpper) || (qClean && cleanSerialCore(s).includes(qClean))) {
        seenSerials.add(s);
        matches.push({ ...p, matchScore: 80, matchReason: 'Serie parcial' });
        continue;
      }

      // Modelo contiene el texto
      if (pMaterial.includes(qLower)) {
        seenSerials.add(s);
        matches.push({ ...p, matchScore: 60, matchReason: 'Modelo' });
        continue;
      }

      // Espacio o fila contiene el texto
      if (pSpace.includes(qLower) || pRow.includes(qLower)) {
        seenSerials.add(s);
        matches.push({ ...p, matchScore: 40, matchReason: 'Ubicación' });
        continue;
      }
    }

    // Ordenar: mayor puntaje primero
    return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, 15);
  }, [query, printers]);

  // Manejo de selección
  const handleSelectPrinter = (printer) => {
    if (!printer) return;
    setIsOpen(false);
    setQuery('');

    const hasLocation = printer.warehouseRow && 
      printer.warehouseRow.trim() !== '' && 
      printer.warehouseRow !== 'Sin Asignar';

    if (hasLocation) {
      if (onLocateEquipment) {
        onLocateEquipment(printer);
      }
    } else {
      if (onUnlocatedSelected) {
        onUnlocatedSelected(printer);
      }
    }
  };

  // Manejo de teclado (Enter, Flechas Arriba/Abajo, Escape)
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen(true);
      setSelectedIndex(prev => (prev + 1 < searchResults.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults.length > 0) {
        const item = searchResults[selectedIndex] || searchResults[0];
        handleSelectPrinter(item);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input de Búsqueda Universal */}
      <div className="relative flex items-center">
        <div className="absolute left-3 pointer-events-none text-red-300">
          <svg className="w-4 h-4 text-slate-400 group-focus-within:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => {
            if (query.trim().length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck="false"
          className={`w-full bg-white text-slate-800 placeholder-slate-400 rounded-xl pl-9 pr-16 py-1.5 text-xs font-medium border border-slate-200 shadow-inner focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all ${
            compact ? 'py-1 text-xs' : 'py-2 text-xs sm:text-sm'
          }`}
        />

        {/* Acciones derecha: Borrar o Atajo */}
        <div className="absolute right-2 flex items-center gap-1">
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="text-slate-400 hover:text-slate-600 p-1 text-xs transition"
              title="Borrar texto"
            >
              ✕
            </button>
          ) : (
            <kbd className="hidden sm:inline-block bg-slate-100 text-slate-500 text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-200">
              Ctrl+K
            </kbd>
          )}
        </div>
      </div>

      {/* Menú Flotante de Resultados en Tiempo Real */}
      {isOpen && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-fade-in max-h-96 flex flex-col">
          {/* Cabecera del desplegable */}
          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>
              {searchResults.length > 0 
                ? `${searchResults.length} equipo(s) coincidente(s) - Presiona Enter para ubicar` 
                : 'Búsqueda en inventario'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">Ubicación en vivo</span>
          </div>

          {/* Lista de resultados */}
          <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
            {searchResults.length > 0 ? (
              searchResults.map((printer, idx) => {
                const isSelected = idx === selectedIndex;
                const isLocated = printer.warehouseRow && 
                  printer.warehouseRow.trim() !== '' && 
                  printer.warehouseRow !== 'Sin Asignar';

                return (
                  <div
                    key={`${printer.serial}-${idx}`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => handleSelectPrinter(printer)}
                    className={`p-3 cursor-pointer transition flex flex-col gap-1 ${
                      isSelected ? 'bg-red-50/80 border-l-4 border-red-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Fila 1: Modelo y Estado */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {printer.material || 'Modelo sin especificar'}
                        </span>
                        {printer.internalNumber && (
                          <span className="bg-slate-100 text-slate-800 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                            #{printer.internalNumber}
                          </span>
                        )}
                      </div>

                      {/* Insignia de estado */}
                      {printer.isConsulta ? (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                          CONSULTA
                        </span>
                      ) : printer.isBaja ? (
                        <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">
                          BAJA
                        </span>
                      ) : (
                        <span className="bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0">
                          DISPONIBLE
                        </span>
                      )}
                    </div>

                    {/* Fila 2: Serie y Coincidencia */}
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">Serie:</span>
                        <span className="font-mono font-bold text-slate-700">{printer.serial}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 italic">
                        {printer.matchReason}
                      </span>
                    </div>

                    {/* Fila 3: Ruta de Ubicación FÍSICA en Almacén */}
                    <div className="mt-1 pt-1 border-t border-slate-100/80 flex items-center justify-between">
                      {isLocated ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-800 font-bold bg-emerald-50/90 px-2 py-1 rounded-lg border border-emerald-200/80 w-full">
                          <span className="text-sm">📍</span>
                          <span className="truncate">
                            {printer.warehouseName || 'Almacén 1'} &gt; {printer.warehouseRow} &gt; {printer.warehouseSpace || 'Espacio General'}
                          </span>
                          <span className="ml-auto text-[10px] font-medium text-emerald-600 bg-white px-1.5 py-0.5 rounded shadow-2xs shrink-0">
                            Ver en Mapa
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-amber-800 font-semibold bg-amber-50 px-2 py-1 rounded-lg border border-amber-200/80 w-full">
                          <span className="text-sm">⚠️</span>
                          <span>Pendiente de acomodo (Sin ubicación física)</span>
                          <span className="ml-auto text-[10px] font-medium text-amber-700 bg-white px-1.5 py-0.5 rounded shadow-2xs shrink-0">
                            Ubicar
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-slate-400">
                <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs font-semibold text-slate-600">No se encontró ningún equipo</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Verifica que el número de serie, número interno o modelo coincida con el inventario.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
