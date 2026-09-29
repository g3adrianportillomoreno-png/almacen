export default function Header({ view, setView }) {
  return (
    <header className="bg-red-700 text-white shadow-md p-4 flex justify-between items-center">
      <h1 className="text-3xl font-black tracking-wider">CDM</h1>
      {view === 'scan' && (
        <button 
          onClick={() => setView('home')}
          className="text-sm bg-white text-red-700 px-4 py-1.5 rounded-full font-bold hover:bg-gray-100 transition"
        >
          Volver al Inicio
        </button>
      )}
    </header>
  );
}
