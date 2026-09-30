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
      expectedSeries: ['TRL-101', 'TRL-102', 'TRL-103', '65078126', '25013355', '95030569', '05015423', '05016143', '05013973'],
      completed: [],
      unexpectedLogs: []
    },
    {
      id: 2,
      name: 'Checklist Tarde',
      date: new Date().toLocaleDateString('es-MX'),
      expectedSeries: ['TRL-201', 'TRL-202'],
      completed: ['TRL-201'],
      unexpectedLogs: []
    }
  ]);

  const activeBatch = batches.find(b => b.id === activeBatchId);

  const handleCreateBatch = (fileName, series) => {
    const newId = batches.length > 0 ? Math.max(...batches.map(b => b.id)) + 1 : 1;
    const newBatch = {
      id: newId,
      name: `Lote: ${fileName.replace('.xlsx', '')}`,
      date: new Date().toLocaleDateString('es-MX'),
      expectedSeries: series,
      completed: [],
      unexpectedLogs: []
    };
    
    setBatches([newBatch, ...batches]);
    setActiveBatchId(newId);
    setView('scan'); // Ir directamente a escanear
  };

  const handleSelectBatch = (batchId) => {
    setActiveBatchId(batchId);
    setView('scan');
  };

  const handleCompleteTrailer = (serie) => {
    setBatches(prevBatches => 
      prevBatches.map(batch => {
        if (batch.id === activeBatchId) {
          if (!batch.completed.includes(serie)) {
            return {
              ...batch,
              completed: [...batch.completed, serie]
            };
          }
        }
        return batch;
      })
    );
  };

  const handleLogUnexpected = (serie) => {
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
            onLogUnexpected={handleLogUnexpected}
            onFinishSession={handleFinishSession}
          />
        )}
      </main>
    </div>
  );
}

export default App;