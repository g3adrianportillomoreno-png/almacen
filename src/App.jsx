import { useState, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, matchPath } from 'react-router-dom';
import './App.css';

// Capa de Controladores (Patrón MVC)
import { ChecklistController } from './controllers/ChecklistController';
import { WarehouseMapController } from './controllers/WarehouseMapController';
import { InventoryController } from './controllers/InventoryController';
import { MercadoLibreController } from './controllers/MercadoLibreController';

// Componentes y Vistas
import Header from './components/Header';
import OfflineSyncBanner from './components/OfflineSyncBanner';
import { OfflineSyncService } from './services/OfflineSyncService';
import HomeView from './components/HomeView';
import ScanSessionView from './components/ScanSessionView';
import ModelSearchView from './components/ModelSearchView';
import WarehouseMapView from './components/WarehouseMapView';
import WarehouseAssignmentView from './components/WarehouseAssignmentView';
import MasterInventoryView from './components/MasterInventoryView';
import EquipmentReadingView from './components/EquipmentReadingView';
import OperatorMobileView from './components/OperatorMobileView';
import MercadoLibreView from './components/MercadoLibreView';
import MercadoLibreScanView from './components/MercadoLibreScanView';
import BajasSessionView from './components/BajasSessionView';
import ConsumiblesView from './components/ConsumiblesView';
import ConsumiblesChecklistScanView from './components/ConsumiblesChecklistScanView.jsx';
import { RealtimeSyncService } from './services/RealtimeSyncService';
import { supabase } from './utils/supabaseClient';

const VIEW_TO_PATH = {
  masterInventory: '/inventario',
  home: '/recepciones',
  mercadoLibre: '/mercado-libre',
  bajas: '/bajas',
  warehouseMap: '/mapa',
  modelSearch: '/modelos',
  consumibles: '/consumibles',
  equipmentReading: '/acomodo',
  assignment: '/acomodo',
  operator: '/operador',
};

const getViewFromPathname = (pathname) => {
  if (pathname.startsWith('/operador')) return 'operator';
  if (pathname.startsWith('/recepciones/escaneo/')) return 'scan';
  if (pathname.startsWith('/recepciones')) return 'home';
  if (pathname.startsWith('/consumibles/escaneo/')) return 'consumablesScan';
  if (pathname.startsWith('/consumibles')) return 'consumibles';
  if (pathname.startsWith('/mercado-libre/escaneo/')) return 'mercadoLibreScan';
  if (pathname.startsWith('/mercado-libre')) return 'mercadoLibre';
  if (pathname.startsWith('/bajas')) return 'bajas';
  if (pathname.startsWith('/mapa')) return 'warehouseMap';
  if (pathname.startsWith('/modelos')) return 'modelSearch';
  if (pathname.startsWith('/acomodo')) return 'equipmentReading';
  return 'masterInventory';
};

const getDefaultRoutePath = () => {
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('modo') === 'operador' || window.location.hash.includes('operador')) {
      return '/operador';
    }
    const saved = localStorage.getItem('preferred_view');
    if (saved && VIEW_TO_PATH[saved]) {
      return VIEW_TO_PATH[saved];
    }
    if (window.innerWidth < 768) {
      return '/operador';
    }
  }
  return '/inventario';
};

function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Vista actual derivada directamente de la URL del navegador
  const view = useMemo(() => getViewFromPathname(location.pathname), [location.pathname]);

  // IDs de lotes activos derivados directamente de los parámetros de la URL
  const scanMatch = matchPath('/recepciones/escaneo/:batchId', location.pathname);
  const consumablesScanMatch = matchPath('/consumibles/escaneo/:batchId', location.pathname);
  const mlScanMatch = matchPath('/mercado-libre/escaneo/:batchId', location.pathname);

  const activeBatchId = scanMatch?.params?.batchId || consumablesScanMatch?.params?.batchId || null;
  const activeMlBatchId = mlScanMatch?.params?.batchId || null;

  // Helper central de navegación por vista (actualiza URL real)
  const setView = useCallback((nextView, options = {}) => {
    const targetPath = VIEW_TO_PATH[nextView] || '/inventario';
    navigate(targetPath, options);
  }, [navigate]);

  const [batches, setBatches] = useState(() => ChecklistController.getCachedChecklistsSync());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Lotes y Sesiones de Mercado Libre
  const [mlBatches, setMlBatches] = useState([]);

  // Lote preseleccionado para Modo Bajas (soporta ?lote=ID en URL)
  const [bajasPreselectedBatchId, setBajasPreselectedBatchId] = useState(null);
  const effectiveBajasBatchId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('lote') || bajasPreselectedBatchId;
  }, [location.search, bajasPreselectedBatchId]);

  // Notificación flotante de sincronización en tiempo real (ej. cuando se sube un nuevo archivo maestro)
  const [realtimeNotification, setRealtimeNotification] = useState(null);

  // Obtener nombres de filas disponibles desde el layout del mapa
  const [mapModel, setMapModel] = useState(() => WarehouseMapController.loadMap());

  const handleLayoutChange = useCallback(() => {
    setMapModel(WarehouseMapController.loadMap());
  }, []);

  const availableRows = useMemo(() => {
    return mapModel.getAllRowNames ? mapModel.getAllRowNames() : mapModel.getRowNames();
  }, [mapModel]);

  // Carga centralizada de checklists usando el controlador
  const fetchBatches = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      setErrorMessage(null);
      const loadedBatches = await ChecklistController.getChecklists();
      setBatches(loadedBatches);
    } catch (error) {
      console.error("Error al cargar lotes:", error);
      setErrorMessage("No se pudieron cargar los datos de Supabase. Revisa tu conexión.");
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Carga centralizada de lotes de Mercado Libre
  const fetchMlBatches = useCallback(async () => {
    try {
      const loaded = await MercadoLibreController.getBatches();
      setMlBatches(loaded);
    } catch (err) {
      console.warn("Error cargando lotes de Mercado Libre:", err);
    }
  }, []);

  useEffect(() => {
    fetchMlBatches();
  }, [fetchMlBatches]);

  // Sincronización en tiempo real híbrida (Alternativa 1: Broadcast instantáneo + Polling + Visibility + WebSockets)
  useEffect(() => {
    // 1. Escuchar actualizaciones en vivo
    const unsubscribeSync = RealtimeSyncService.onSync((eventInfo) => {
      fetchBatches(true);
      fetchMlBatches();
      handleLayoutChange();
    });

    // 2. Escuchar avisos visuales (ej. cuando oficina sube un archivo maestro)
    const unsubscribeNotif = RealtimeSyncService.onNotification((msg) => {
      setRealtimeNotification(msg);
      setTimeout(() => {
        setRealtimeNotification(null);
      }, 4500);
    });

    return () => {
      unsubscribeSync();
      unsubscribeNotif();
    };
  }, [fetchBatches, fetchMlBatches, handleLayoutChange]);

  // Sincronización automática de lotes tras flush de cola offline
  useEffect(() => {
    const unsubscribe = OfflineSyncService.onSyncComplete(() => {
      fetchBatches(true);
      fetchMlBatches();
      handleLayoutChange();
    });
    return () => unsubscribe();
  }, [fetchBatches, fetchMlBatches, handleLayoutChange]);

  // Lote activo en escaneo (comparación flexible String para soportar parámetros de URL)
  const activeBatch = useMemo(() => {
    if (!activeBatchId) return null;
    return batches.find(b => String(b.id) === String(activeBatchId)) || null;
  }, [batches, activeBatchId]);

  // Lote activo en escaneo de Mercado Libre
  const activeMlBatch = useMemo(() => {
    if (!activeMlBatchId) return null;
    return mlBatches.find(b => String(b.id) === String(activeMlBatchId)) || null;
  }, [mlBatches, activeMlBatchId]);

  // Todas las impresoras en inventario activo
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(batches);
  }, [batches]);

  // Absolutamente todas las impresoras del sistema (incluyendo pendientes de lectura física)
  const allSystemPrinters = useMemo(() => {
    return InventoryController.extractAllExpectedPrinters(batches);
  }, [batches]);

  // Conteo total de impresoras en estado de CONSULTA para alerta global
  const totalConsultas = useMemo(() => {
    return allPrinters.filter(p => p.isConsulta).length;
  }, [allPrinters]);

  // Estado para el equipo localizado en el mapa gráfico ("¿Dónde está este equipo?")
  const [highlightTarget, setHighlightTarget] = useState(null);
  const [unlocatedModalTarget, setUnlocatedModalTarget] = useState(null);

  // Acción cuando se selecciona un equipo con ubicación: llevar al Mapa y resaltarlo
  const handleLocateEquipment = useCallback((printer) => {
    setHighlightTarget({
      serial: printer.serial,
      material: printer.material,
      internalNumber: printer.internalNumber,
      warehouseName: printer.warehouseName || 'Almacén 1',
      warehouseRow: printer.warehouseRow || 'Fila 1',
      warehouseSpace: printer.warehouseSpace || '',
      status: printer.status || 'DISPONIBLE',
      timestamp: Date.now()
    });
    setView('warehouseMap');
  }, []);

  // Acción cuando se selecciona un equipo que aún no tiene ubicación asignada
  const handleUnlocatedSelected = useCallback((printer) => {
    setUnlocatedModalTarget(printer);
  }, []);

  // Crear nuevo lote con número consecutivo
  const handleCreateBatch = async (fileName, series, consecutiveNumber) => {
    try {
      setLoading(true);
      const batchData = await ChecklistController.createChecklist(fileName, series, consecutiveNumber);
      await fetchBatches();
      navigate(`/recepciones/escaneo/${encodeURIComponent(batchData.id)}`);
    } catch (err) {
      alert("Error al crear el lote: " + err.message);
      setLoading(false);
    }
  };

  const handleSelectBatch = (batchId, batchType = 'EQUIPMENT') => {
    if (batchType === 'CONSUMIBLES') {
      navigate(`/consumibles/escaneo/${encodeURIComponent(batchId)}`);
    } else {
      navigate(`/recepciones/escaneo/${encodeURIComponent(batchId)}`);
    }
  };

  // Registrar escaneo de impresora asignando su Almacén, Fila, Espacio y Número de inventario
  const handleCompleteTrailer = async (serie, assignmentData, specificBatchId = null) => {
    const targetBatchId = specificBatchId || assignmentData?.batchId || activeBatch?.id || activeBatchId;
    const targetBatch = batches.find(b => String(b.id) === String(targetBatchId)) || activeBatch;
    if (!targetBatchId || !targetBatch) return;

    if (assignmentData?.warehouseRow) {
      WarehouseMapController.ensureRowExists(assignmentData.warehouseRow, assignmentData.warehouseName);
      handleLayoutChange();
    }

    // Actualización optimista local en memoria
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (String(batch.id) === String(targetBatchId)) {
          const serial = serie.toUpperCase();
          const newCompleted = batch.completed.includes(serial)
            ? batch.completed
            : [...batch.completed, serial];

          const updatedExpected = batch.expectedSeries.map(item => {
            if (item.serial === serial) {
              const wasRel = assignmentData?.wasRelocated !== undefined
                ? assignmentData.wasRelocated
                : item.wasRelocated;
              const locStatus = assignmentData?.locationStatus || item.locationStatus || (wasRel ? 'RELOCATED' : 'VERIFIED_OK');

              return {
                ...item,
                isScanned: true,
                warehouseName: assignmentData?.warehouseName || item.warehouseName,
                warehouseRow: assignmentData?.warehouseRow || item.warehouseRow,
                warehouseSpace: assignmentData?.warehouseSpace !== undefined ? assignmentData.warehouseSpace : item.warehouseSpace,
                internalNumber: assignmentData?.internalNumber !== undefined ? assignmentData.internalNumber : item.internalNumber,
                wasRelocated: wasRel,
                locationStatus: locStatus,
                originalLocation: assignmentData?.originalLocation || item.originalLocation
              };
            }
            return item;
          });

          const isDone = newCompleted.length >= batch.expectedSeries.length;
          return {
            ...batch,
            completed: newCompleted,
            expectedSeries: updatedExpected,
            status: isDone ? 'completed' : batch.status
          };
        }
        return batch;
      })
    );

    // Persistencia asíncrona a través del controlador
    try {
      await ChecklistController.recordSuccessfulScan(targetBatchId, serie, assignmentData?.warehouseRow, targetBatch, assignmentData?.internalNumber);
      if (assignmentData && (assignmentData.warehouseSpace || assignmentData.warehouseRow)) {
        await InventoryController.assignPrinter(serie, assignmentData);
      }
    } catch (error) {
      console.error("Error persistiendo escaneo:", error);
    }
  };

  // Registrar serie fuera de lista
  const handleLogUnexpected = async (serie, specificBatchId = null) => {
    const targetBatchId = specificBatchId || activeBatch?.id || activeBatchId;
    if (!targetBatchId) return;

    const serial = serie.toUpperCase();

    // Optimista local
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (String(batch.id) === String(targetBatchId)) {
          const logs = batch.unexpectedLogs || [];
          if (!logs.includes(serial)) {
            return {
              ...batch,
              unexpectedLogs: [serial, ...logs]
            };
          }
        }
        return batch;
      })
    );

    await ChecklistController.recordUnexpectedScan(targetBatchId, serial);
  };

  // Reconciliar una serie faltante con una lectura que dio error por diferencia de OCR
  const handleReconcileSimilar = async (match, specificBatchId = null) => {
    const targetBatchId = specificBatchId || activeBatch?.id || activeBatchId;
    const targetBatch = batches.find(b => String(b.id) === String(targetBatchId)) || activeBatch;
    if (!targetBatchId || !targetBatch || !match) return;

    const oldSerial = String(match.expectedSerial || '').trim().toUpperCase();
    const realSerial = String(match.scannedSerial || '').trim().toUpperCase();
    const rawUnexp = String(match.rawUnexpected || realSerial).trim().toUpperCase();

    // Actualización optimista inmediata en pantalla
    setBatches(prevBatches =>
      prevBatches.map(batch => {
        if (String(batch.id) !== String(targetBatchId)) return batch;

        const updatedExpected = (batch.expectedSeries || []).map(item => {
          if (item.serial === oldSerial) {
            return {
              ...item,
              serial: realSerial,
              isScanned: true
            };
          }
          return item;
        });

        const baseCompleted = (batch.completed || []).filter(s => s !== oldSerial);
        const newCompleted = baseCompleted.includes(realSerial)
          ? baseCompleted
          : [...baseCompleted, realSerial];

        const newUnexpected = (batch.unexpectedLogs || []).filter(u => {
          const val = typeof u === 'string' ? u.trim().toUpperCase() : String(u?.scannedValue || u?.scanned_value || '').trim().toUpperCase();
          return val !== rawUnexp && val !== realSerial;
        });

        const isDone = newCompleted.length >= updatedExpected.length;

        return {
          ...batch,
          expectedSeries: updatedExpected,
          completed: newCompleted,
          unexpectedLogs: newUnexpected,
          status: isDone ? 'completed' : batch.status
        };
      })
    );

    try {
      await ChecklistController.reconcileSimilarSerial(
        targetBatchId,
        oldSerial,
        realSerial,
        rawUnexp,
        targetBatch
      );
    } catch (err) {
      console.error('Error al reconciliar coincidencia:', err);
    }
  };

  // Eliminar checklist
  const handleDeleteBatch = async (batchId) => {
    const confirmDelete = window.confirm("¿Estás seguro de que deseas eliminar este checklist? Esta acción no se puede deshacer.");
    if (!confirmDelete) return;

    // Optimista local
    setBatches(prevBatches => prevBatches.filter(b => b.id !== batchId));

    try {
      await ChecklistController.removeChecklist(batchId);
    } catch (err) {
      alert("Error al eliminar en la BD: " + err.message);
      fetchBatches();
    }
  };

  // Finalizar lote incompleto
  const handleForceFinishBatch = async () => {
    const confirm = window.confirm("¿Seguro que deseas finalizar el lote? Faltan equipos por escanear.");
    if (!confirm) return;

    const resolvedBatchId = activeBatch?.id || activeBatchId;
    if (!resolvedBatchId) return;
    setBatches(prev => prev.map(b => String(b.id) === String(resolvedBatchId) ? { ...b, status: 'closed' } : b));
    await ChecklistController.forceFinishChecklist(resolvedBatchId);
  };

  // Marcar una serie del checklist como baja (salida de almacén)
  const handleMarkChecklistBaja = async (serial, bajaDate, reason, specificBatchId = null, requestedBy = null, dispatchedBy = null) => {
    const targetBatchId = specificBatchId || activeBatch?.id || activeBatchId;
    if (!targetBatchId || !serial) return;

    const sUpper = String(serial).trim().toUpperCase();
    const dateVal = bajaDate ? new Date(bajaDate).toISOString() : new Date().toISOString();

    // Optimista local inmediato en pantalla
    setBatches(prev => prev.map(b => {
      if (String(b.id) !== String(targetBatchId)) return b;
      const updatedExpected = (b.expectedSeries || []).map(p => {
        if (p.serial === sUpper) {
          return {
            ...p,
            status: 'BAJA',
            isBaja: true,
            bajaAt: dateVal,
            departure_date: dateVal,
            bajaReason: reason,
            requestedBy: requestedBy || p.requestedBy || null,
            requested_by: requestedBy || p.requested_by || p.requestedBy || null,
            dispatchedBy: dispatchedBy || p.dispatchedBy || 'Operador',
            dispatched_by: dispatchedBy || p.dispatched_by || p.dispatchedBy || 'Operador',
            isScanned: true
          };
        }
        return p;
      });
      const newCompleted = b.completed.includes(sUpper) ? b.completed : [...b.completed, sUpper];
      return {
        ...b,
        expectedSeries: updatedExpected,
        completed: newCompleted
      };
    }));

    try {
      await ChecklistController.markChecklistPrinterBaja(targetBatchId, sUpper, dateVal, reason, requestedBy, dispatchedBy);
    } catch (err) {
      console.error('Error al registrar baja de checklist:', err);
    }
  };

  // Cancelar la baja de una serie de checklist (restaurar a disponible)
  const handleCancelChecklistBaja = async (serial, specificBatchId = null) => {
    const targetBatchId = specificBatchId || activeBatch?.id || activeBatchId;
    if (!targetBatchId || !serial) return;

    const sUpper = String(serial).trim().toUpperCase();

    // Optimista local inmediato en pantalla
    setBatches(prev => prev.map(b => {
      if (String(b.id) !== String(targetBatchId)) return b;
      const updatedExpected = (b.expectedSeries || []).map(p => {
        if (p.serial === sUpper) {
          return {
            ...p,
            status: 'DISPONIBLE',
            bajaAt: null,
            bajaReason: null
          };
        }
        return p;
      });
      return {
        ...b,
        expectedSeries: updatedExpected
      };
    }));

    try {
      await ChecklistController.cancelChecklistPrinterBaja(targetBatchId, sUpper);
    } catch (err) {
      console.error('Error al cancelar baja de checklist:', err);
    }
  };

  const handleFinishSession = () => {
    navigate('/recepciones');
    fetchBatches();
  };

  // Handlers para Módulo Mercado Libre
  const handleCreateMlBatch = async (fileName, items, consecutive) => {
    const created = await MercadoLibreController.createBatch(fileName, items, consecutive);
    await fetchMlBatches();
    return created;
  };

  const handleSelectMlBatch = (batchId) => {
    navigate(`/mercado-libre/escaneo/${encodeURIComponent(batchId)}`);
  };

  const handleDeleteMlBatch = async (batchId) => {
    await MercadoLibreController.deleteBatch(batchId);
    setMlBatches(prev => prev.filter(b => String(b.id) !== String(batchId)));
    await fetchMlBatches();
  };

  const handleRecordMlScan = async (batchId, itemId, method) => {
    setMlBatches(prev => prev.map(b => {
      if (String(b.id) === String(batchId)) {
        const updatedItems = b.items.map(it => {
          if (String(it.id) === String(itemId)) {
            return {
              ...it,
              isScanned: true,
              scannedAt: new Date().toISOString(),
              scannedWith: method
            };
          }
          return it;
        });
        return {
          ...b,
          items: updatedItems
        };
      }
      return b;
    }));

    await MercadoLibreController.recordSuccessfulScan(batchId, itemId, method, activeMlBatch);
  };

  const handleRecordMlUnexpected = async (batchId, code) => {
    setMlBatches(prev => prev.map(b => {
      if (String(b.id) === String(batchId)) {
        const logs = b.unexpectedLogs || [];
        return {
          ...b,
          unexpectedLogs: [{ id: Date.now(), scannedValue: code, createdAt: new Date().toISOString() }, ...logs]
        };
      }
      return b;
    }));

    await MercadoLibreController.recordUnexpectedScan(batchId, code);
  };

  const handleFinishMlSession = () => {
    navigate('/mercado-libre');
    fetchMlBatches();
  };

  const handleForceFinishMlBatch = async () => {
    if (activeMlBatchId) {
      await MercadoLibreController.forceFinishBatch(activeMlBatchId);
      await fetchMlBatches();
    }
  };

  const handleRequestAdminView = () => {
    const password = window.prompt("Introduce la contraseña de acceso a Oficina:");
    if (password === 'QWERTY' || password === 'qwerty') {
      localStorage.setItem('preferred_view', 'masterInventory');
      setView('masterInventory');
    } else if (password !== null) {
      alert("Contraseña incorrecta. Acceso restringido al Modo Operador.");
    }
  };

  // Redirección inmediata desde la raíz '/' según preferencia / móvil / modo operador
  if (location.pathname === '/') {
    return <Navigate to={getDefaultRoutePath()} replace />;
  }

  // Si la vista es Modo Operador Móvil, renderizamos su pantalla táctil dedicada inmediatamente sin bloqueo
  if (view === 'operator') {
    return (
      <>
        {/* AVISO FLOTANTE DE SINCRONIZACIÓN EN TIEMPO REAL */}
        {realtimeNotification && (
          <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-emerald-400 border border-emerald-500/60 shadow-2xl px-4 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in backdrop-blur-md max-w-sm text-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span>{realtimeNotification}</span>
          </div>
        )}
        <OperatorMobileView 
          batches={batches}
          isLoading={loading}
          onRefreshData={() => {
            fetchBatches();
            fetchMlBatches();
          }}
          onCompleteTrailer={handleCompleteTrailer}
          onLogUnexpected={handleLogUnexpected}
          onReconcileSimilar={handleReconcileSimilar}
          onAssignmentSaved={() => {
            fetchBatches(true);
            handleLayoutChange();
          }}
          onRequestAdminView={handleRequestAdminView}
          availableWarehouses={mapModel.warehouses.map(w => w.name)}
          availableRows={availableRows}
          mlBatches={mlBatches}
          onRecordMlScan={handleRecordMlScan}
          onRecordMlUnexpected={handleRecordMlUnexpected}
          onRefreshMl={fetchMlBatches}
          onForceFinishMlBatch={handleForceFinishMlBatch}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-gray-800">
      {/* AVISO FLOTANTE DE SINCRONIZACIÓN EN TIEMPO REAL */}
      {realtimeNotification && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-emerald-400 border border-emerald-500/60 shadow-2xl px-4 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>{realtimeNotification}</span>
        </div>
      )}

      {/* Barra de Navegación Superior */}
      <Header 
        currentView={view} 
        setView={(v) => {
          localStorage.setItem('preferred_view', v);
          setView(v);
        }}
        activeBatchId={activeBatchId || activeMlBatchId}
        consultaCount={totalConsultas}
        printers={allSystemPrinters}
        onLocateEquipment={handleLocateEquipment}
        onUnlocatedSelected={handleUnlocatedSelected}
      />

      {/* Contenido Principal a Pantalla Completa */}
      <main className="flex-1 flex flex-col w-full max-w-[1920px] mx-auto px-3 sm:px-6 lg:px-8 py-4">
        <OfflineSyncBanner className="mb-3" />
        {errorMessage && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-xl flex justify-between items-center text-xs font-medium">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
            <button onClick={fetchBatches} className="underline hover:text-rose-900 ml-4 font-semibold">Reintentar</button>
          </div>
        )}

        {loading && (view === 'home' || view === 'masterInventory') && batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-16 h-16 border-4 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-500 font-semibold">Cargando inventario y lotes de Supabase...</p>
          </div>
        ) : (
          <Routes>
            {/* Raíz: redirige inteligentemente según preferencia / móvil / modo operador */}
            <Route path="/" element={<Navigate to={getDefaultRoutePath()} replace />} />

            {/* Vista 1: Inventario Maestro de Almacén (7 Columnas) */}
            <Route
              path="/inventario"
              element={
                <MasterInventoryView 
                  allPrinters={allPrinters}
                  onInventoryChange={() => {
                    fetchBatches();
                    handleLayoutChange();
                  }}
                  availableWarehouses={mapModel.warehouses.map(w => w.name)}
                  availableRows={availableRows}
                  onNavigateToChecklists={() => setView('home')}
                />
              }
            />

            {/* Vista 2: Pantalla de Recepciones / Checklists de Lotes */}
            <Route
              path="/recepciones"
              element={
                <HomeView 
                  batches={batches}
                  onCreateBatch={handleCreateBatch} 
                  onSelectBatch={handleSelectBatch}
                  onDeleteBatch={handleDeleteBatch}
                  onNavigateToModelSearch={() => setView('modelSearch')}
                  onNavigateToAssignment={() => setView('equipmentReading')}
                  onNavigateToReading={() => setView('equipmentReading')}
                  onNavigateToMasterInventory={() => setView('masterInventory')}
                  onNavigateToBajas={(batchId) => {
                    setBajasPreselectedBatchId(batchId || null);
                    navigate(batchId ? `/bajas?lote=${encodeURIComponent(batchId)}` : '/bajas');
                  }}
                  onStatusChange={fetchBatches}
                  onLayoutChange={handleLayoutChange}
                />
              }
            />

            {/* Vista 3: Sesión de Escaneo de Checklist (soporta recarga directa por URL) */}
            <Route
              path="/recepciones/escaneo/:batchId"
              element={
                activeBatch ? (
                  <ScanSessionView 
                    batchDetails={activeBatch}
                    onCompleteTrailer={handleCompleteTrailer}
                    onLogUnexpected={handleLogUnexpected}
                    onReconcileSimilar={handleReconcileSimilar}
                    onFinishSession={handleFinishSession}
                    onForceFinish={handleForceFinishBatch}
                    onMarkBaja={handleMarkChecklistBaja}
                    onCancelBaja={handleCancelChecklistBaja}
                    onNavigateToBajas={() => {
                      setBajasPreselectedBatchId(activeBatch.id);
                      navigate(`/bajas?lote=${encodeURIComponent(activeBatch.id)}`);
                    }}
                    availableRows={availableRows}
                    availableWarehouses={mapModel.warehouses.map(w => w.name)}
                    allPrinters={allPrinters}
                  />
                ) : loading ? (
                  <div className="flex flex-col items-center justify-center h-64">
                    <div className="w-12 h-12 border-4 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
                    <p className="mt-3 text-gray-500 text-sm font-semibold">Cargando sesión de escaneo...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                    <p className="text-slate-600 font-bold">No se encontró el lote solicitado.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/recepciones')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Volver a Recepciones
                    </button>
                  </div>
                )
              }
            />

            {/* Vista 4: Lectura y Acomodo de Equipos */}
            <Route
              path="/acomodo"
              element={
                <EquipmentReadingView 
                  checklists={batches}
                  onAssignmentSaved={() => {
                    fetchBatches();
                    handleLayoutChange();
                  }}
                  availableWarehouses={mapModel.warehouses.map(w => w.name)}
                  availableRows={availableRows}
                  onBackToHome={() => setView('home')}
                />
              }
            />

            {/* Vista 5: Buscador por Modelo (CONSULTA y BAJA) */}
            <Route
              path="/modelos"
              element={
                <ModelSearchView 
                  checklists={batches}
                  onStatusChange={fetchBatches}
                  onRowChange={fetchBatches}
                  availableRows={availableRows}
                />
              }
            />

            {/* Vista 6: Mapa de Almacén con Rectángulos y Rangos de Serie */}
            <Route
              path="/mapa"
              element={
                <WarehouseMapView 
                  checklists={batches}
                  onLayoutChange={handleLayoutChange}
                  onPrinterChange={fetchBatches}
                  highlightTarget={highlightTarget}
                  onClearHighlight={() => setHighlightTarget(null)}
                  onLocateEquipment={handleLocateEquipment}
                  onUnlocatedSelected={handleUnlocatedSelected}
                  onNavigateToReading={() => setView('equipmentReading')}
                />
              }
            />

            {/* Vista 7: Mercado Libre - Lista de Lotes */}
            <Route
              path="/mercado-libre"
              element={
                <MercadoLibreView 
                  batches={mlBatches}
                  onCreateBatch={handleCreateMlBatch}
                  onSelectBatch={handleSelectMlBatch}
                  onDeleteBatch={handleDeleteMlBatch}
                  onRefresh={fetchMlBatches}
                />
              }
            />

            {/* Vista 8: Mercado Libre - Sesión de Escaneo */}
            <Route
              path="/mercado-libre/escaneo/:batchId"
              element={
                activeMlBatch ? (
                  <MercadoLibreScanView 
                    batchDetails={activeMlBatch}
                    onRecordScan={handleRecordMlScan}
                    onRecordUnexpected={handleRecordMlUnexpected}
                    onFinishSession={handleFinishMlSession}
                    onForceFinish={handleForceFinishMlBatch}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                    <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 text-xs font-semibold">Cargando lote de Mercado Libre...</p>
                    <button
                      type="button"
                      onClick={() => navigate('/mercado-libre')}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Volver a Mercado Libre
                    </button>
                  </div>
                )
              }
            />

            {/* Vista 9: Modo Bajas y Salidas de Inventario */}
            <Route
              path="/bajas"
              element={
                <BajasSessionView 
                  batches={batches}
                  allPrinters={allPrinters}
                  allSystemPrinters={allSystemPrinters}
                  preselectedBatchId={effectiveBajasBatchId}
                  onBajasCommitted={async () => {
                    await fetchBatches(true);
                    handleLayoutChange();
                  }}
                  onBack={() => setView('masterInventory')}
                />
              }
            />

            {/* Vista 10: Módulo de Consumibles y Refacciones */}
            <Route path="/consumibles" element={<ConsumiblesView />} />

            {/* Vista 11: Sesión de Escaneo de Checklist de Consumibles */}
            <Route
              path="/consumibles/escaneo/:batchId"
              element={
                <ConsumiblesChecklistScanView 
                  batchId={activeBatchId}
                  onBack={() => {
                    navigate('/recepciones');
                    fetchBatches();
                  }}
                  onBatchUpdated={fetchBatches}
                />
              }
            />

            {/* Cualquier ruta desconocida redirige al inicio */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      {/* Modal de Aviso para Equipos sin Ubicación Física Asignada */}
      {unlocatedModalTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-fade-in-up">
            <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center text-2xl mb-4">
              ⚠️
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Equipo sin Ubicación en el Mapa
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              El equipo con serie <strong className="text-slate-900 font-mono font-bold">{unlocatedModalTarget.serial}</strong> ({unlocatedModalTarget.material}) está registrado en el sistema, pero <strong>aún no tiene asignado Almacén, Fila ni Espacio</strong> físico.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5 text-xs text-slate-600 flex flex-col gap-1.5 font-medium">
              <div><span className="text-slate-400 font-semibold">Lote / Origen:</span> {unlocatedModalTarget.batchFolio || unlocatedModalTarget.batchName || 'Recepción'}</div>
              <div><span className="text-slate-400 font-semibold">Estado actual:</span> {unlocatedModalTarget.status || 'DISPONIBLE'}</div>
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setUnlocatedModalTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnlocatedModalTarget(null);
                  setView('equipmentReading');
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-xs flex items-center justify-center gap-1.5"
              >
                <span>📦</span> Ubicar en Almacén
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
