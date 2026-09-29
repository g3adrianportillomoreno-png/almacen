import { useState } from 'react';
import ChecklistForm from './ChecklistForm';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import CameraScanner from './CameraScanner';

export default function ScanSessionView({ batchDetails, onCompleteTrailer, onFinishSession }) {
  const [isSearching, setIsSearching] = useState(false);
  const [currentTrailer, setCurrentTrailer] = useState(null);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  
  // Nuevo estado para controlar si estamos usando la cámara
  const [useCamera, setUseCamera] = useState(false);

  const total = batchDetails.expectedSeries.length;
  const escaneados = batchDetails.completed.length;
  const faltantes = total - escaneados;

  const processScan = (scannedCode) => {
    if (scannedCode.trim() === '') return;
    if (currentTrailer) return; // Si ya hay un checklist abierto, ignorar escaneos

    setLastScanned(scannedCode.trim().toUpperCase());
    setIsSearching(true);
    setSearchSuccess(false);
    // Si usó la cámara, la cerramos al detectar algo
    setUseCamera(false);
    
    setTimeout(() => {
      setIsSearching(false);
      const code = scannedCode.trim().toUpperCase();
      
      const isExpected = batchDetails.expectedSeries.includes(code);
      const isAlreadyDone = batchDetails.completed.some(c => c.serie === code);

      if (isAlreadyDone) {
        alert(`El tráiler ${code} ya fue procesado en este lote.`);
        setLastScanned('');
        return;
      }

      if (isExpected) {
        setSearchSuccess(true);
        setTimeout(() => {
          setCurrentTrailer({ serie: code });
          setSearchSuccess(false);
          setLastScanned('');
        }, 1000);
      } else {
        alert(`El código ${code} no se encuentra en la lista de esperados para este lote.`);
        setLastScanned('');
      }
    }, 1200); 
  };

  // Escucha el escáner globalmente (la pistola de código de barras)
  useBarcodeScanner(processScan);

  const handleSaveChecklist = (checklistData) => {
    onCompleteTrailer(currentTrailer.serie, checklistData);
    setCurrentTrailer(null);
  };

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in">
      <div className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-red-600 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">{batchDetails.name}</h2>
          <p className="text-gray-500 text-sm">Fecha de arribo: <span className="font-semibold text-gray-700">{batchDetails.date}</span></p>
        </div>
        <div className="text-right flex gap-4 text-sm font-semibold">
          <div className="flex flex-col items-center">
            <span className="text-gray-500">Total</span>
            <span className="text-xl text-gray-800">{total}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-gray-500">Hechos</span>
            <span className="text-xl text-green-600">{escaneados}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-gray-500">Faltan</span>
            <span className="text-xl text-red-600">{faltantes}</span>
          </div>
        </div>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div className="bg-red-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${(escaneados / total) * 100}%` }}></div>
      </div>

      {!currentTrailer && escaneados < total && (
        <section className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center min-h-[300px]">
          {isSearching ? (
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-16 h-16 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
              <p className="text-xl font-bold text-gray-600">Buscando serie: <span className="text-red-600">{lastScanned}</span>...</p>
            </div>
          ) : searchSuccess ? (
            <div className="flex flex-col items-center gap-4 animate-bounce">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center shadow-lg">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <p className="text-2xl font-bold text-green-700">¡Encontrado!</p>
            </div>
          ) : useCamera ? (
            <CameraScanner 
              expectedSeries={batchDetails.expectedSeries} 
              onScan={processScan} 
              onCancel={() => setUseCamera(false)} 
            />
          ) : (
            <div className="w-full max-w-md flex flex-col items-center gap-6">
              <div className="bg-red-50 p-6 rounded-full text-red-600 animate-pulse">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4"></path></svg>
              </div>
              <div className="w-full bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center flex flex-col items-center gap-4">
                <div>
                  <p className="text-xl font-bold text-gray-500">LISTO PARA ESCANEAR</p>
                  <p className="text-sm text-gray-400 mt-1">Dispara la pistola en cualquier lugar</p>
                </div>
                
                <span className="text-gray-400 text-sm font-semibold">— O —</span>

                <button 
                  onClick={() => setUseCamera(true)}
                  className="bg-gray-800 hover:bg-black text-white font-bold py-3 px-6 rounded-xl flex items-center gap-3 transition-colors shadow-sm w-full justify-center"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  Leer con la Cámara del Celular
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {escaneados === total && total > 0 && (
        <section className="bg-green-50 border-2 border-green-500 p-8 rounded-xl shadow-sm text-center flex flex-col items-center gap-4">
          <div className="w-24 h-24 bg-green-500 text-white rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h2 className="text-3xl font-bold text-green-700">¡Checklist Completado!</h2>
          <p className="text-green-600">Se han verificado todos los equipos esperados.</p>
          <button onClick={onFinishSession} className="mt-4 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full transition-colors shadow-md">
            Finalizar Sesión
          </button>
        </section>
      )}

      {currentTrailer && (
        <ChecklistForm 
          trailer={currentTrailer} 
          onSave={handleSaveChecklist} 
          onCancel={() => setCurrentTrailer(null)} 
        />
      )}

      {batchDetails.completed.length > 0 && (
        <div className="mt-8">
          <h3 className="text-gray-500 font-bold mb-3 uppercase text-sm tracking-wider">Equipos procesados en este lote</h3>
          <div className="flex flex-wrap gap-2">
            {batchDetails.completed.map((item, idx) => (
              <span key={idx} className="bg-green-100 text-green-800 px-3 py-1.5 rounded-lg text-sm font-bold font-mono border border-green-200 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                {item.serie}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
