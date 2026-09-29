import { useState } from 'react';
import './App.css';

// Componentes
import Header from './components/Header';
import HomeView from './components/HomeView';
import ScanSessionView from './components/ScanSessionView';

function App() {
  const [view, setView] = useState('home'); // 'home', 'scan'
  const [activeBatchId, setActiveBatchId] = useState(null);

  // MOCK DATA: Historial global de lotes / checklists
  const [batches, setBatches] = useState([
    {
      id: 1,
      name: 'Checklist Mañana',
      date: new Date().toLocaleDateString('es-MX'),
      expectedSeries: ['TRL-101', 'TRL-102', 'TRL-103'],
      completed: []
    },
    {
      id: 2,
      name: 'Checklist Tarde',
      date: new Date().toLocaleDateString('es-MX'),
      expectedSeries: ['TRL-201', 'TRL-202'],
      completed: [
        { serie: 'TRL-201', llantas: 'Buenas', luces: 'Ok' },
        { serie: 'TRL-202', llantas: 'Malas', luces: 'Falla' }
      ]
    }
  ]);

  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleCreateBatch = (fileName, series) => {
    const newId = batches.length > 0 ? Math.max(...batches.map(b => b.id)) + 1 : 1;
    const newBatch = {
      id: newId,
      name: `Lote: ${fileName.replace('.pdf', '')}`,
      date: new Date().toLocaleDateString('es-MX'),
      expectedSeries: series,
      completed: []
    };
    
    setBatches([newBatch, ...batches]);
    setActiveBatchId(newId);
    setView('scan'); // Ir directamente a escanear
  };

  const handleSelectBatch = (batchId) => {
    setActiveBatchId(batchId);
    setView('scan');
  };

  const handleCompleteTrailer = (serie, checklistData) => {
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
          return {
            ...batch,
            completed: [...batch.completed, { serie, ...checklistData }]
          };
        }
        return batch;
      })
    );
  };

  const handleFinishSession = () => {
    setActiveBatchId(null);
    setView('home');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <Header view={view} setView={() => { setView('home'); setActiveBatchId(null); }} />

      <main className="flex-1 flex flex-col w-full max-w-4xl mx-auto p-4 md:p-8">
        {view === 'home' && (
          <HomeView 
            batches={batches}
            onCreateBatch={handleCreateBatch} 
            onSelectBatch={handleSelectBatch} 
          />
        )}

        {view === 'scan' && activeBatch && (
          <ScanSessionView 
            batchDetails={activeBatch}
            onCompleteTrailer={handleCompleteTrailer}
            onFinishSession={handleFinishSession}
          />
        )}
      </main>
    </div>
  );
}

export default App;