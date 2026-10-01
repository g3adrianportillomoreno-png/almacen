import { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './utils/supabaseClient';

// Componentes
import Header from './components/Header';
import HomeView from './components/HomeView';
import ScanSessionView from './components/ScanSessionView';

function App() {
  const [view, setView] = useState('home'); // 'home', 'scan'
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cargar datos de Supabase
  const fetchBatches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('checklists')
      .select(`
        id, name, created_at, status,
        expected_series (id, serial_number, material_model, is_scanned),
        unexpected_logs (id, scanned_value)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error cargando lotes:", error);
      setLoading(false);
      return;
    }

    const loadedBatches = data.map(dbBatch => ({
      id: dbBatch.id,
      name: dbBatch.name,
      date: new Date(dbBatch.created_at).toLocaleDateString('es-MX'),
      status: dbBatch.status,
      expectedSeries: dbBatch.expected_series.map(s => ({
        serial: s.serial_number,
        material: s.material_model,
        is_scanned: s.is_scanned
      })),
      completed: dbBatch.expected_series
        .filter(s => s.is_scanned)
        .map(s => s.serial_number),
      unexpectedLogs: dbBatch.unexpected_logs.map(log => log.scanned_value)
    }));

    setBatches(loadedBatches);
    setLoading(false);
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleCreateBatch = async (fileName, series) => {
    const { data: batchData, error: batchError } = await supabase
      .from('checklists')
      .insert({ name: `Lote: ${fileName.replace('.xlsx', '')}`, status: 'pending' })
      .select()
      .single();

    if (batchError || !batchData) {
      alert("Error al crear lote en la BD: " + batchError.message);
      return;
    }

    const seriesToInsert = series.map(s => ({
      checklist_id: batchData.id,
      serial_number: s.serial,
      material_model: s.material,
      is_scanned: false
    }));

    const { error: seriesError } = await supabase
      .from('expected_series')
      .insert(seriesToInsert);

    if (seriesError) {
      alert("Error al insertar series: " + seriesError.message);
      return;
    }

    await fetchBatches();
    setActiveBatchId(batchData.id);
    setView('scan'); // Ir directamente a escanear
  };

  const handleSelectBatch = (batchId) => {
    setActiveBatchId(batchId);
    setView('scan');
  };

  const handleCompleteTrailer = async (serie) => {
    let shouldUpdateStatus = false;

    // Actualización optimista local
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
          if (!batch.completed.includes(serie)) {
            const newCompleted = [...batch.completed, serie];
            if (newCompleted.length === batch.expectedSeries.length) {
              shouldUpdateStatus = true;
              return { ...batch, completed: newCompleted, status: 'completed' };
            }
            return { ...batch, completed: newCompleted };
          }
        }
        return batch;
      })
    );

    // Actualización en Supabase
    await supabase
      .from('expected_series')
      .update({ is_scanned: true, scanned_at: new Date().toISOString() })
      .eq('checklist_id', activeBatchId)
      .eq('serial_number', serie);

    if (shouldUpdateStatus) {
      await supabase
        .from('checklists')
        .update({ status: 'completed' })
        .eq('id', activeBatchId);
    }
  };

  const handleLogUnexpected = async (serie) => {
    // Actualización optimista local
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
          const logs = batch.unexpectedLogs || [];
          if (!logs.includes(serie)) {
            return {
              ...batch,
              unexpectedLogs: [serie, ...logs]
            };
          }
        }
        return batch;
      })
    );

    // Guardar en Supabase
    await supabase
      .from('unexpected_logs')
      .insert({
        checklist_id: activeBatchId,
        scanned_value: serie
      });
  };

  const handleDeleteBatch = async (batchId) => {
    const confirmDelete = window.confirm("¿Estás seguro de que deseas eliminar este checklist? Esta acción no se puede deshacer.");
    if (!confirmDelete) return;

    // Eliminar localmente para respuesta inmediata
    setBatches(prevBatches => prevBatches.filter(b => b.id !== batchId));

    // Eliminar en Supabase
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', batchId);

    if (error) {
      alert("Error al eliminar en la BD: " + error.message);
      fetchBatches(); // Recargar para revertir si hubo error
    }
  };

  const handleFinishSession = () => {
    setActiveBatchId(null);
    setView('home');
    fetchBatches(); // Refrescar por si hubo cambios de red
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <Header view={view} setView={() => { setView('home'); setActiveBatchId(null); }} />

      <main className="flex-1 flex flex-col w-full max-w-4xl mx-auto p-4 md:p-8">
        {loading && view === 'home' ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-16 h-16 border-4 border-gray-200 border-t-red-600 rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-500 font-semibold">Conectando a Supabase...</p>
          </div>
        ) : view === 'home' ? (
          <HomeView 
            batches={batches}
            onCreateBatch={handleCreateBatch} 
            onSelectBatch={handleSelectBatch}
            onDeleteBatch={handleDeleteBatch}
          />
        ) : null}

        {view === 'scan' && activeBatch && (
          <ScanSessionView 
            batchDetails={activeBatch}
            onCompleteTrailer={handleCompleteTrailer}
            onLogUnexpected={handleLogUnexpected}
            onFinishSession={handleFinishSession}
          />
        )}
      </main>
    </div>
  );
}

export default App;