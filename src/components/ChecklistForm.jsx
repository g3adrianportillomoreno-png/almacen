import { useState } from 'react';

export default function ChecklistForm({ trailer, onSave, onCancel }) {
  const [checklist, setChecklist] = useState({
    llantas: '',
    luces: '',
    frenos: '',
    estadoCaja: '',
    comentarios: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(checklist);
  };

  return (
    <section className="bg-white p-6 md:p-8 rounded-xl shadow-lg border-t-8 border-red-600 animate-fade-in-up">
      <div className="mb-6 flex justify-between items-center border-b pb-4">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">Inspección de Unidad</h3>
          <p className="text-gray-500 mt-1">Complete los datos para guardar la recepción</p>
        </div>
        <div className="bg-red-50 px-4 py-2 rounded-lg border border-red-100">
          <span className="text-red-800 font-bold font-mono text-xl">{trailer.serie}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="flex flex-col gap-2">
            <label className="font-bold text-gray-700">Llantas</label>
            <select required className="border-2 border-gray-200 rounded-lg p-3 focus:border-red-600 outline-none text-gray-700" value={checklist.llantas} onChange={(e) => setChecklist({...checklist, llantas: e.target.value})}>
              <option value="">Seleccione estado...</option>
              <option value="buenas">Buenas</option>
              <option value="regulares">Regulares</option>
              <option value="malas">Malas</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-bold text-gray-700">Luces</label>
            <select required className="border-2 border-gray-200 rounded-lg p-3 focus:border-red-600 outline-none text-gray-700" value={checklist.luces} onChange={(e) => setChecklist({...checklist, luces: e.target.value})}>
              <option value="">Seleccione estado...</option>
              <option value="ok">Funcionan</option>
              <option value="fallan_algunas">Fallas parciales</option>
              <option value="no_funcionan">No funcionan</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-bold text-gray-700">Frenos</label>
            <select required className="border-2 border-gray-200 rounded-lg p-3 focus:border-red-600 outline-none text-gray-700" value={checklist.frenos} onChange={(e) => setChecklist({...checklist, frenos: e.target.value})}>
              <option value="">Seleccione estado...</option>
              <option value="ok">Ok</option>
              <option value="revision">Requiere revisión</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-bold text-gray-700">Caja y Sellos</label>
            <select required className="border-2 border-gray-200 rounded-lg p-3 focus:border-red-600 outline-none text-gray-700" value={checklist.estadoCaja} onChange={(e) => setChecklist({...checklist, estadoCaja: e.target.value})}>
              <option value="">Seleccione estado...</option>
              <option value="intacta">Intacta</option>
              <option value="danada">Daños / Rotos</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <label className="font-bold text-gray-700">Comentarios Adicionales</label>
          <textarea 
            rows="3"
            className="border-2 border-gray-200 rounded-lg p-3 focus:border-red-600 outline-none resize-none text-gray-700"
            placeholder="Observaciones..."
            value={checklist.comentarios}
            onChange={(e) => setChecklist({...checklist, comentarios: e.target.value})}
          ></textarea>
        </div>

        <div className="flex justify-end gap-4 mt-6">
          <button type="button" onClick={onCancel} className="px-6 py-3 rounded-lg font-bold text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors">
            Cancelar
          </button>
          <button type="submit" className="px-8 py-3 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-md flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            Completar y Guardar
          </button>
        </div>
      </form>
    </section>
  );
}
