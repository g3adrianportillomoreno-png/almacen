import { useState, useEffect } from 'react';

export default function PWAInstallButton({ className = '', variant = 'button' }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // 1. Detectar si ya está en modo pantalla completa / Standalone
    const checkStandalone = () => {
      const isStandaloneMode = 
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();

    // 2. Detectar si es iOS (iPhone/iPad)
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(ua) && !window.MSStream;
    setIsIOS(isAppleDevice);

    // 3. Capturar el evento de instalación de PWA en navegadores compatibles (Chrome, Edge, etc.)
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 4. Escuchar cuando la app sea instalada exitosamente
    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setShowInstructionsModal(false);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Si ya está instalada y ejecutándose en pantalla completa, no mostrar botón de descarga
  if (isStandalone) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Disparador nativo para Android / Chrome / Edge
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      // Si no está disponible el prompt nativo (iOS Safari o ya denegado), abrir modal explicativo
      setShowInstructionsModal(true);
    }
  };

  return (
    <>
      {variant === 'banner' ? (
        <div className={`bg-gradient-to-r from-red-900/90 via-slate-900 to-red-950 border border-red-500/40 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg ${className}`}>
          <div className="flex items-center gap-3 text-left">
            <div className="w-10 h-10 rounded-xl bg-red-600/30 border border-red-500/50 flex items-center justify-center text-xl shrink-0">
              📲
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-black text-white">
                ¿Usas celular? Instala la App en tu pantalla
              </h4>
              <p className="text-[11px] text-slate-300">
                Oculta las barras del navegador y aprovecha el 100% de la pantalla para escanear.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-black text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <span>⬇️</span>
            <span>Instalar App</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          className={`px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer active:scale-95 ${className}`}
          title="Descarga la app en tu celular para pantalla completa sin barra de navegador"
        >
          <span>📲</span>
          <span className="hidden sm:inline">Descargar App</span>
          <span className="sm:hidden">App</span>
        </button>
      )}

      {/* MODAL CON INSTRUCCIONES PASO A PASO */}
      {showInstructionsModal && (
        <div 
          onClick={() => setShowInstructionsModal(false)}
          className="fixed inset-0 z-70 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border-2 border-red-500 w-full max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl text-white flex flex-col gap-4 animate-in zoom-in-95"
          >
            {/* Header del Modal */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center font-black text-white text-lg shadow-sm">
                  CDM
                </div>
                <div>
                  <h3 className="font-black text-base text-white">Instalar Almacén CDM</h3>
                  <p className="text-[11px] text-emerald-400 font-bold">✓ Modo Pantalla Completa (Sin navegador)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Beneficio clave */}
            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 text-xs text-slate-300">
              <p className="font-bold text-white mb-1">🎯 ¿Para qué instalarla?</p>
              <p>
                Al agregarla a tu pantalla de inicio, se abrirá como una aplicación nativa. 
                <span className="text-amber-300 font-bold"> Ocultará la barra de direcciones URL y las barras de navegación de abajo</span>, 
                dándote toda la pantalla libre para escanear y recibir mercancía.
              </p>
            </div>

            {/* Instrucciones según el sistema */}
            <div className="flex flex-col gap-2.5 text-xs">
              <span className="font-black text-slate-300 uppercase text-[10px] tracking-wider">
                Instrucciones según tu celular:
              </span>

              {isIOS ? (
                /* INSTRUCCIONES IPHONE (SAFARI) */
                <div className="bg-red-950/40 border border-red-500/40 rounded-2xl p-3.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold text-red-300">
                    <span>🍎</span>
                    <span>iPhone / iPad (Safari):</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-200">
                    <li>
                      Toca el botón <strong className="text-white">Compartir 📤</strong> (en la barra inferior de Safari).
                    </li>
                    <li>
                      Desliza hacia abajo y selecciona <strong className="text-white">"Agregar a inicio" ➕</strong>.
                    </li>
                    <li>
                      Toca <strong className="text-white">"Agregar"</strong> en la esquina superior derecha.
                    </li>
                    <li>
                      ¡Listo! Abre el ícono de <strong className="text-emerald-400">Almacén CDM</strong> desde tu pantalla principal.
                    </li>
                  </ol>
                </div>
              ) : (
                /* INSTRUCCIONES ANDROID (CHROME) */
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-400">
                    <span>🤖</span>
                    <span>Android / Chrome:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-200">
                    <li>
                      Toca el menú de los <strong className="text-white">3 puntos (⋮)</strong> en la esquina superior derecha de Chrome.
                    </li>
                    <li>
                      Selecciona <strong className="text-white">"Instalar aplicación"</strong> o <strong className="text-white">"Agregar a la pantalla principal"</strong>.
                    </li>
                    <li>
                      Confirma <strong className="text-white">"Instalar"</strong>.
                    </li>
                    <li>
                      ¡Listo! La app se agregará a tu pantalla y se abrirá sin el navegador.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            {/* Botón de cierre */}
            <button
              type="button"
              onClick={() => setShowInstructionsModal(false)}
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-black text-xs rounded-2xl transition shadow-lg cursor-pointer text-center"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
