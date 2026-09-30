import { useState, useCallback, useRef } from 'react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { extractSeriesFromExcel } from '../utils/excelParser';

export default function HomeView({ batches, onCreateBatch, onSelectBatch }) {
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [showPending, setShowPending] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  
  const fileInputRef = useRef(null);

  const pendingBatches = batches.filter(b => b.completed.length < b.expectedSeries.length);

  const searchInHistory = useCallback((codeToSearch) => {
    if (!codeToSearch) return;
    const code = codeToSearch.toUpperCase();
    
    let foundTrailer = null;
    let foundBatch = null;

    for (const batch of batches) {
      const isExpected = batch.expectedSeries.includes(code);
      const isCompleted = batch.completed.includes(code);
      
      if (isExpected || isCompleted) {
        foundBatch = batch;
        foundTrailer = { serie: code, pending: !isCompleted };
        break;
      }
    }

    if (foundTrailer && foundBatch) {
      if (foundTrailer.pending) {
        setSearchResult({
          serie: foundTrailer.serie,
          date: foundBatch.date,
          status: 'Pendiente en Checklist',
          batchName: foundBatch.name,
          isPending: true
        });
        setSearchResult({
          serie: foundTrailer.serie,
          date: foundBatch.date,
          status: 'Completado',
          batchName: foundBatch.name
        });
      }
    } else {
      setSearchResult({ notFound: true, serie: code });
    }
  }, [batches]);

  useBarcodeScanner((scannedCode) => {
    setSearchCode(scannedCode);
    searchInHistory(scannedCode);
  });

  const handleManualSearch = (e) => {
    e.preventDefault();
    searchInHistory(searchCode.trim());
  };

  // Manejador de la subida de Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessingFile(true);

    try {
      const extractedSeries = await extractSeriesFromExcel(file);
      
      if (extractedSeries.length === 0) {
        alert("La columna 'Serial Number' se encontró pero no tiene datos, o el formato es incorrecto.");
        setIsProcessingFile(false);
        return;
      }

      alert(`¡Éxito! Se encontraron ${extractedSeries.length} números de serie en el documento Excel.`);
      onCreateBatch(file.name, extractedSeries);
    } catch (error) {
      alert("Error al procesar el Excel: " + error.message);
      setIsProcessingFile(false);
    }
    
    // Resetear el input por si suben el mismo archivo después
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col items-center justify-start flex-1 gap-12 animate-fade-in w-full">
      <h2 className="text-2xl md:text-3xl font-bold text-gray-700 mt-4 text-center">
        Sistema de Recepción
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        {/* Input invisible para el archivo de Excel */}
        <input 
          type="file" 
          accept=".xlsx, .xls, .csv" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileUpload} 
        />

        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessingFile}
          className={`flex flex-col items-center gap-4 bg-white border-2 border-red-200 p-8 rounded-2xl shadow-sm hover:border-red-600 hover:shadow-md transition-all group ${isProcessingFile ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessingFile ? (
            <div className="w-16 h-16 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center animate-spin border-4 border-gray-300 border-t-red-600"></div>
          ) : (
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
          )}
          <span className="text-lg font-bold text-gray-700 group-hover:text-red-700">
            {isProcessingFile ? 'Procesando Excel...' : 'Subir Documento (Excel)'}
          </span>
        </button>

        <button 
          onClick={() => setShowPending(!showPending)}
          className="flex flex-col items-center gap-4 bg-white border-2 border-red-200 p-8 rounded-2xl shadow-sm hover:border-red-600 hover:shadow-md transition-all group relative"
        >
          {pendingBatches.length > 0 && (
            <span className="absolute top-4 right-4 bg-red-600 text-white font-bold text-xs px-2.5 py-1 rounded-full animate-pulse">
              {pendingBatches.length}
            </span>
          )}
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
          </div>
          <span className="text-lg font-bold text-gray-700 group-hover:text-red-700">Seleccionar Checklist</span>
        </button>
      </div>

      {showPending && (
        <div className="w-full max-w-2xl bg-white p-6 rounded-2xl shadow-sm border border-red-200 animate-fade-in-up">
          <h3 className="text-xl font-bold text-red-700 mb-4">Checklists Pendientes</h3>
          {pendingBatches.length === 0 ? (
            <p className="text-gray-500 text-center py-4">¡Felicidades! No hay checklists por hacer.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingBatches.map(batch => (
                <button 
                  key={batch.id} 
                  onClick={() => onSelectBatch(batch.id)}
                  className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200 hover:border-red-400 hover:bg-red-50 transition-colors"
                >
                  <div className="text-left">
                    <p className="font-bold text-gray-800">{batch.name}</p>
                    <p className="text-sm text-gray-500">{batch.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">
                      Faltan: {batch.expectedSeries.length - batch.completed.length}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="w-full max-w-2xl border-t border-gray-300"></div>

      <div className="w-full max-w-2xl bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="text-xl font-bold text-gray-800 mb-2">Consulta de Unidad</h3>
        <p className="text-gray-500 text-sm mb-6">Usa tu pistola de código de barras aquí en cualquier momento para ver el estado de un equipo.</p>
        
        <form onSubmit={handleManualSearch} className="flex gap-2">
          <input
            type="text"
            className="flex-1 border-2 border-gray-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 rounded-lg p-3 text-lg transition-all font-mono uppercase"
            placeholder="ESCANEAR CON PISTOLA..."
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
          />
          <button type="submit" className="bg-gray-800 hover:bg-black text-white px-6 py-3 rounded-lg font-bold transition-colors">
            Buscar
          </button>
        </form>

        {searchResult && (
          <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50 animate-fade-in-up">
            {searchResult.notFound ? (
              <div className="flex items-center gap-3 text-red-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <p className="font-semibold">No se encontró historial para la unidad <span className="font-mono bg-white px-2 py-0.5 border rounded text-red-800">{searchResult.serie}</span></p>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-lg font-bold text-gray-800 font-mono">{searchResult.serie}</h4>
                    <p className="text-sm text-gray-500">Llegada: {searchResult.date} ({searchResult.batchName})</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold border ${searchResult.isPending ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-green-100 text-green-800 border-green-200'}`}>
                    {searchResult.status}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
