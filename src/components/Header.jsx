export default function Header({ currentView, setView, activeBatchId, consultaCount = 0 }) {
  return (
    <header className="bg-red-700 text-white shadow-md sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap justify-between items-center gap-3">
        {/* Logo y título */}
        <div 
          onClick={() => setView('home')} 
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-10 h-10 bg-white text-red-700 rounded-xl flex items-center justify-center font-black text-xl shadow group-hover:scale-105 transition-transform">
            CDM
          </div>
          <div>
            <h1 className="text-xl font-black tracking-wide leading-none">ALMACÉN CDM</h1>
            <p className="text-xs text-red-200 font-medium">Control de Recepción e Inventario</p>
          </div>
        </div>

        {/* Pestañas de Navegación */}
        <nav className="flex items-center gap-2">
          {activeBatchId ? (
            <div className="flex items-center gap-2">
              <span className="text-xs bg-red-800 text-white px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                Sesión de Escaneo Activa
              </span>
              <button 
                onClick={() => setView('home')}
                className="text-xs bg-white text-red-700 px-3.5 py-1.5 rounded-lg font-bold hover:bg-gray-100 transition shadow-sm"
              >
                Pausar y Volver
              </button>
            </div>
          ) : (
            <div className="flex items-center bg-red-800/70 p-1 rounded-xl text-sm font-semibold">
              <button
                onClick={() => setView('home')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  currentView === 'home' 
                    ? 'bg-white text-red-700 shadow-sm' 
                    : 'text-red-100 hover:text-white hover:bg-red-800'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                Recepción
              </button>

              <button
                onClick={() => setView('modelSearch')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 relative ${
                  currentView === 'modelSearch' 
                    ? 'bg-white text-red-700 shadow-sm' 
                    : 'text-red-100 hover:text-white hover:bg-red-800'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                Buscador por Modelo
                {consultaCount > 0 && (
                  <span className="bg-yellow-400 text-yellow-950 font-black text-xs px-1.5 py-0.2 rounded-full">
                    {consultaCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setView('warehouseMap')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  currentView === 'warehouseMap' 
                    ? 'bg-white text-red-700 shadow-sm' 
                    : 'text-red-100 hover:text-white hover:bg-red-800'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                Mapa de Almacén
              </button>

              <button
                onClick={() => setView('assignment')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  currentView === 'assignment' 
                    ? 'bg-white text-red-700 shadow-sm' 
                    : 'text-red-100 hover:text-white hover:bg-red-800'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Asignación
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
