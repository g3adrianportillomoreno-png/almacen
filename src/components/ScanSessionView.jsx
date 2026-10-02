import { useState } from 'react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import CameraScanner from './CameraScanner';

export default function ScanSessionView({ batchDetails, onCompleteTrailer, onLogUnexpected, onFinishSession, onForceFinish }) {
  const [isSearching, setIsSearching] = useState(false);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [lastScanned, setLastScanned] = useState('');
  const [lastScannedMaterial, setLastScannedMaterial] = useState('');
  
  const [useCamera, setUseCamera] = useState(false);

  const total = batchDetails.expectedSeries.length;
  const escaneados = batchDetails.completed.length;
  const faltantes = total - escaneados;
  
  const isFinished = batchDetails.status === 'completed' || escaneados === total;

  const processScan = (scannedCode) => {
    if (scannedCode.trim() === '' || isFinished) return;

    setLastScanned(scannedCode.trim().toUpperCase());
    setIsSearching(true);
    setSearchSuccess(false);
    setSearchError(false);
    setUseCamera(false);
    
    setTimeout(() => {
      setIsSearching(false);
      const code = scannedCode.trim().toUpperCase();
      
      const expectedItem = batchDetails.expectedSeries.find(item => item.serial === code);
      const isAlreadyDone = batchDetails.completed.includes(code);

      if (isAlreadyDone) {
        setLastScanned('');
        return;
      }

      if (expectedItem) {
        setLastScannedMaterial(expectedItem.material);
        setSearchSuccess(true);
        setTimeout(() => {
          onCompleteTrailer(code); 
          setSearchSuccess(false);
          setLastScanned('');
        }, 1200);
      } else {
        setSearchError(true);
        onLogUnexpected(code);
        setTimeout(() => {
          setSearchError(false);
          setLastScanned('');
        }, 2000); 
      }
    }, 800); 
  };

  useBarcodeScanner(processScan);

  if (isFinished) {
    const faltantesList = batchDetails.expectedSeries.filter(item => !batchDetails.completed.includes(item.serial));
    
    return (
      <div className="flex flex-col gap-6 w-full animate-fade-in">
        <section className="bg-green-50 border-2 border-green-500 p-8 rounded-xl shadow-sm text-center flex flex-col items-center gap-4">
          <div className="w-24 h-24 bg-green-500 text-white rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h2 className="text-3xl font-bold text-green-700">¡Reporte del Lote!</h2>
          <p className="text-green-600 font-bold">{batchDetails.name}</p>
        </section>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Resumen de Recepción</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-bold text-green-700 mb-2 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                Equipos Recibidos ({batchDetails.completed.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {batchDetails.expectedSeries.filter(item => batchDetails.completed.includes(item.serial)).map((item, idx) => (
                  <div key={idx} className="bg-green-50 p-2 rounded border border-green-100 flex justify-between">
                    <span className="font-mono font-bold">{item.serial}</span>
                    <span className="text-gray-500 text-xs">{item.material}</span>
                  </div>
                ))}
              </div>
            </div>

            {faltantesList.length > 0 && (
              <div>
                <h4 className="font-bold text-yellow-600 mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  Equipos Faltantes ({faltantesList.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {faltantesList.map((item, idx) => (
                    <div key={idx} className="bg-yellow-50 p-2 rounded border border-yellow-100 flex justify-between">
                      <span className="font-mono font-bold">{item.serial}</span>
                      <span className="text-gray-500 text-xs">{item.material}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {batchDetails.unexpectedLogs && batchDetails.unexpectedLogs.length > 0 && (
              <div>
                <h4 className="font-bold text-red-600 mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  Lecturas Inesperadas ({batchDetails.unexpectedLogs.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  {batchDetails.unexpectedLogs.map((item, idx) => (
                    <div key={idx} className="bg-red-50 p-2 rounded border border-red-100">
                      <span className="font-mono font-bold text-red-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <button onClick={onFinishSession} className="mt-8 w-full bg-gray-800 hover:bg-black text-white font-bold py-3 px-8 rounded-xl transition-colors shadow-md">
            Cerrar Reporte e Ir al Inicio
          </button>
        </div>
      </div>
    );
  }

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

      <section className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center min-h-[300px]">
        {isSearching ? (
          <div className="flex flex-col items-center gap-4 animate-pulse">
            <div className="w-16 h-16 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
            <p className="text-xl font-bold text-gray-600">Procesando serie: <span className="text-red-600">{lastScanned}</span>...</p>
          </div>
        ) : searchSuccess ? (
          <div className="flex flex-col items-center gap-2 animate-bounce">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center shadow-lg mb-2">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p className="text-2xl font-bold text-green-700">¡Registrado Correctamente!</p>
            <p className="text-gray-700 font-mono text-xl">{lastScanned}</p>
            {lastScannedMaterial && <p className="text-sm font-bold bg-gray-100 px-3 py-1 rounded text-gray-600">Modelo: {lastScannedMaterial}</p>}
          </div>
        ) : searchError ? (
          <div className="flex flex-col items-center gap-4 animate-pulse">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center shadow-lg border-4 border-red-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
            </div>
            <p className="text-2xl font-bold text-red-700">¡Fuera de Lista!</p>
            <p className="text-red-500 font-mono">{lastScanned}</p>
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

      <div className="flex justify-between items-center px-2">
        <button onClick={onFinishSession} className="text-gray-500 hover:text-gray-800 font-bold transition-colors">
          &larr; Volver al Inicio
        </button>
        {faltantes > 0 && (
          <button onClick={onForceFinish} className="text-red-500 hover:text-red-700 font-bold transition-colors text-sm border border-red-200 hover:border-red-500 px-3 py-1 rounded-full">
            Finalizar Lote Incompleto
          </button>
        )}
      </div>
    </div>
  );
}
