import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

// Capa de Controladores (Patrón MVC)
import { ChecklistController } from './controllers/ChecklistController';
import { WarehouseMapController } from './controllers/WarehouseMapController';
import { InventoryController } from './controllers/InventoryController';

// Componentes y Vistas
import Header from './components/Header';
import HomeView from './components/HomeView';
import ScanSessionView from './components/ScanSessionView';
import ModelSearchView from './components/ModelSearchView';
import WarehouseMapView from './components/WarehouseMapView';
import WarehouseAssignmentView from './components/WarehouseAssignmentView';
import MasterInventoryView from './components/MasterInventoryView';
import EquipmentReadingView from './components/EquipmentReadingView';

function App() {
  const [view, setView] = useState('masterInventory'); // 'masterInventory', 'home', 'scan', 'equipmentReading', 'modelSearch', 'warehouseMap'
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Obtener nombres de filas disponibles desde el layout del mapa
  const [mapModel, setMapModel] = useState(() => WarehouseMapController.loadMap());

  const availableRows = useMemo(() => {
    return mapModel.getRowNames();
  }, [mapModel]);

  // Carga centralizada de checklists usando el controlador
  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const loadedBatches = await ChecklistController.getChecklists();
      setBatches(loadedBatches);
    } catch (error) {
      console.error("Error al cargar lotes:", error);
      setErrorMessage("No se pudieron cargar los datos de Supabase. Revisa tu conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Lote activo en escaneo
  const activeBatch = useMemo(() => {
    return batches.find(b => b.id === activeBatchId);
  }, [batches, activeBatchId]);

  // Todas las impresoras en inventario
  const allPrinters = useMemo(() => {
    return InventoryController.extractAllPrinters(batches);
  }, [batches]);

  // Conteo total de impresoras en estado de CONSULTA para alerta global
  const totalConsultas = useMemo(() => {
    return allPrinters.filter(p => p.isConsulta).length;
  }, [allPrinters]);

  // Crear nuevo lote con número consecutivo
  const handleCreateBatch = async (fileName, series, consecutiveNumber) => {
    try {
      setLoading(true);
      const batchData = await ChecklistController.createChecklist(fileName, series, consecutiveNumber);
      await fetchBatches();
      setActiveBatchId(batchData.id);
      setView('scan'); // Ir directamente a la sesión de escaneo
    } catch (err) {
      alert("Error al crear el lote: " + err.message);
      setLoading(false);
    }
  };

  const handleSelectBatch = (batchId) => {
    setActiveBatchId(batchId);
    setView('scan');
  };

  // Registrar escaneo de impresora asignando su Almacén, Fila, Espacio y Número de inventario
  const handleCompleteTrailer = async (serie, assignmentData) => {
    if (!activeBatchId || !activeBatch) return;

    // Asegurar que la fila exista en el mapa del almacén activo para que aparezca dibujada al instante con su rango numérico
    if (assignmentData?.warehouseRow) {
      WarehouseMapController.ensureRowExists(assignmentData.warehouseRow, assignmentData.warehouseName);
      handleLayoutChange();
    }

    // Actualización optimista local en memoria
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
          const serial = serie.toUpperCase();
          if (!batch.completed.includes(serial)) {
            const newCompleted = [...batch.completed, serial];
            const updatedExpected = batch.expectedSeries.map(item => {
              if (item.serial === serial) {
                return {
                  ...item,
                  isScanned: true,
                  warehouseRow: assignmentData?.warehouseRow || item.warehouseRow,
                  internalNumber: assignmentData?.internalNumber !== undefined ? assignmentData.internalNumber : item.internalNumber
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
        }
        return batch;
      })
    );

    // Persistencia asíncrona a través del controlador
    try {
      await ChecklistController.recordSuccessfulScan(activeBatchId, serie, assignmentData?.warehouseRow, activeBatch, assignmentData?.internalNumber);
      if (assignmentData) {
        await InventoryController.assignPrinter(serie, assignmentData);
      }
    } catch (error) {
      console.error("Error persistiendo escaneo:", error);
    }
  };

  // Registrar serie fuera de lista
  const handleLogUnexpected = async (serie) => {
    if (!activeBatchId) return;

    const serial = serie.toUpperCase();

    // Optimista local
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
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

    await ChecklistController.recordUnexpectedScan(activeBatchId, serial);
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

    setBatches(prev => prev.map(b => b.id === activeBatchId ? { ...b, status: 'closed' } : b));
    await ChecklistController.forceFinishChecklist(activeBatchId);
  };

  const handleFinishSession = () => {
    setActiveBatchId(null);
    setView('home');
    fetchBatches();
  };

  const handleLayoutChange = () => {
    setMapModel(WarehouseMapController.loadMap());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-gray-800">
      {/* Barra de Navegación Superior */}
      <Header 
        currentView={view} 
        setView={(v) => {
          setView(v);
          if (v !== 'scan') setActiveBatchId(null);
        }}
        activeBatchId={activeBatchId}
        consultaCount={totalConsultas}
      />

      {/* Contenido Principal a Pantalla Completa */}
      <main className="flex-1 flex flex-col w-full max-w-[1920px] mx-auto px-3 sm:px-6 lg:px-8 py-4">
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
          <>
            {/* Vista 1: Inventario Maestro de Almacén (7 Columnas) */}
            {view === 'masterInventory' && (
              <MasterInventoryView 
                allPrinters={allPrinters}
                onInventoryChange={fetchBatches}
                availableWarehouses={mapModel.warehouses.map(w => w.name)}
                availableRows={availableRows}
                onNavigateToChecklists={() => setView('home')}
              />
            )}

            {/* Vista 2: Pantalla de Recepciones / Checklists de Lotes */}
            {view === 'home' && (
              <HomeView 
                batches={batches}
                onCreateBatch={handleCreateBatch} 
                onSelectBatch={handleSelectBatch}
                onDeleteBatch={handleDeleteBatch}
                onNavigateToModelSearch={() => setView('modelSearch')}
                onNavigateToAssignment={() => setView('equipmentReading')}
                onNavigateToReading={() => setView('equipmentReading')}
                onNavigateToMasterInventory={() => setView('masterInventory')}
                onStatusChange={fetchBatches}
                onLayoutChange={handleLayoutChange}
              />
            )}

            {/* Vista 3: Sesión de Escaneo de Checklist */}
            {view === 'scan' && activeBatch && (
              <ScanSessionView 
                batchDetails={activeBatch}
                onCompleteTrailer={handleCompleteTrailer}
                onLogUnexpected={handleLogUnexpected}
                onFinishSession={handleFinishSession}
                onForceFinish={handleForceFinishBatch}
                availableRows={availableRows}
                availableWarehouses={mapModel.warehouses.map(w => w.name)}
                allPrinters={allPrinters}
              />
            )}

            {/* Vista 4: Lectura y Acomodo de Equipos (Asignar ubicación a equipos sin ubicación) */}
            {(view === 'equipmentReading' || view === 'assignment') && (
              <EquipmentReadingView 
                checklists={batches}
                onAssignmentSaved={fetchBatches}
                availableWarehouses={mapModel.warehouses.map(w => w.name)}
                availableRows={availableRows}
                onBackToHome={() => setView('home')}
              />
            )}

            {/* Vista 5: Buscador por Modelo (CONSULTA y BAJA) */}
            {view === 'modelSearch' && (
              <ModelSearchView 
                checklists={batches}
                onStatusChange={fetchBatches}
                onRowChange={fetchBatches}
                availableRows={availableRows}
              />
            )}

            {/* Vista 6: Mapa de Almacén con Rectángulos y Rangos de Serie */}
            {view === 'warehouseMap' && (
              <WarehouseMapView 
                checklists={batches}
                onLayoutChange={handleLayoutChange}
                onPrinterChange={fetchBatches}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;