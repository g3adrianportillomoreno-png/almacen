import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { extractSerialFromScanned } from '../utils/serialMatcher.js';

export default function CameraScanner({
  expectedSeries,
  onScan,
  onCancel,
  onScanSuccess,
  onClose,
  initialBurstMode = false
}) {
  const handleScanCallback = onScan || onScanSuccess || (() => {});
  const handleCancelCallback = onCancel || onClose || (() => {});

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const [status, setStatus] = useState('Iniciando cámara...');
  const [lastDetected, setLastDetected] = useState('');
  
  // Modo Ráfaga (Escaneo continuo sin cerrar cámara)
  const [burstMode, setBurstMode] = useState(initialBurstMode);
  const [burstCount, setBurstCount] = useState(0);
  const [flashSuccess, setFlashSuccess] = useState(false);
  const burstModeRef = useRef(burstMode);
  burstModeRef.current = burstMode;
  const lastScannedRef = useRef({ code: '', time: 0 });

  // Controles de hardware
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hasZoom, setHasZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    let isActive = true;
    let requestAnimId = null;

    const setupCamera = async () => {
      try {
        setStatus('Solicitando permisos de cámara...');
        
        // Pedimos resolución alta (1080p ideal) para que jsQR pueda leer a distancia,
        // pero sin obligarlo (exact) para que no falle en iOS.
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          } 
        });
        
        if (!isActive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        
        // Verificar capacidades de la cámara (Linterna y Zoom)
        const track = stream.getVideoTracks()[0];
        if (track.getCapabilities) {
          const capabilities = track.getCapabilities();
          if (capabilities.torch) setHasTorch(true);
          if (capabilities.zoom) setHasZoom(true);
          
          // Intentar auto-enfocar si está disponible
          if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
             track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          
          try {
            await videoRef.current.play();
          } catch (playError) {
            console.error("Error al reproducir el video:", playError);
          }
        }
        
        setStatus('Apuntando al Código QR / Barras...');

        // Instanciar BarcodeDetector una sola vez fuera del ciclo para no saturar el procesador del celular
        let nativeDetector = null;
        if ('BarcodeDetector' in window) {
          try {
            let formats = ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar'];
            if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
              const supported = await window.BarcodeDetector.getSupportedFormats();
              if (supported && supported.length > 0) {
                const filtered = formats.filter(f => supported.includes(f));
                if (filtered.length > 0) formats = filtered;
              }
            }
            nativeDetector = new window.BarcodeDetector({ formats });
          } catch {
            try {
              nativeDetector = new window.BarcodeDetector();
            } catch {
              nativeDetector = null;
            }
          }
        }

        const tick = async () => {
          if (!isActive || !videoRef.current || !canvasRef.current) return;
          
          const video = videoRef.current;
          
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            try {
              let qrText = null;

              // 1. Intentar usar la API Nativa (soporta QR y códigos de barras 1D sin bloquear el hilo principal)
              if (nativeDetector) {
                const barcodes = await nativeDetector.detect(video);
                if (barcodes.length > 0) {
                  qrText = barcodes[0].rawValue;
                }
              }

              // 2. Fallback ligero con jsQR (escalado a máx 640px para no congelar celulares)
              if (!qrText) {
                const canvas = canvasRef.current;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                const scale = Math.min(1, 640 / video.videoWidth);
                const targetW = Math.round(video.videoWidth * scale);
                const targetH = Math.round(video.videoHeight * scale);

                if (canvas.width !== targetW) canvas.width = targetW;
                if (canvas.height !== targetH) canvas.height = targetH;

                context.drawImage(video, 0, 0, targetW, targetH);
                const imageData = context.getImageData(0, 0, targetW, targetH);

                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: "dontInvert",
                });

                if (code) {
                  qrText = code.data;
                }
              }
              
              if (qrText) {
                qrText = qrText.trim().toUpperCase();
                const extractedSerie = extractSerialFromScanned(qrText) || qrText;
                setLastDetected(extractedSerie);

                // --- MODO RÁFAGA (ESCANEO CONTINUO) ---
                if (burstModeRef.current) {
                  const now = Date.now();
                  const isSame = (lastScannedRef.current.code === extractedSerie);
                  const elapsed = now - lastScannedRef.current.time;

                  // Cooldown anti-duplicados accidentales:
                  // Si es el mismo código que ya leyó, esperar 2.2 segundos antes de volver a disparar
                  // Si es un código diferente (otra caja), esperar 380ms
                  if (isSame && elapsed < 2200) {
                    if (isActive) {
                      requestAnimId = setTimeout(tick, 140);
                    }
                    return;
                  }
                  if (!isSame && elapsed < 380) {
                    if (isActive) {
                      requestAnimId = setTimeout(tick, 140);
                    }
                    return;
                  }

                  // Registrar escaneo válido
                  lastScannedRef.current = { code: extractedSerie, time: now };
                  setBurstCount(prev => prev + 1);
                  setFlashSuccess(true);
                  setTimeout(() => setFlashSuccess(false), 700);

                  // Vibración táctil háptica en móviles si está soportada
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try { navigator.vibrate([80, 40, 80]); } catch (_) {}
                  }

                  setStatus(`✓ ¡Leído #${burstCount + 1}: ${extractedSerie}! Apunta al siguiente...`);

                  try {
                    handleScanCallback(extractedSerie, { isBurst: true });
                  } catch (err) {
                    console.error("Error en onScan de ráfaga:", err);
                  }

                  // Continuar ciclo con la cámara ABIERTA
                  if (isActive) {
                    requestAnimId = setTimeout(tick, 280);
                  }
                  return;
                }

                // --- MODO ÚNICO (COMPORTAMIENTO ESTÁNDAR) ---
                setStatus('Código procesado...');
                isActive = false; 
                
                setTimeout(() => {
                  handleScanCallback(extractedSerie, { isBurst: false });
                }, 300);
                return; 
              }
            } catch (err) {
              console.warn("Error leyendo frame:", err);
            }
          }
          
          if (isActive) {
            requestAnimId = setTimeout(tick, 140);
          }
        };

        requestAnimId = setTimeout(tick, 140);

      } catch (err) {
        console.error("Error iniciando cámara:", err);
        setStatus('Error: No se pudo acceder a la cámara.');
      }
    };

    setupCamera();

    return () => {
      isActive = false;
      if (requestAnimId) clearTimeout(requestAnimId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [expectedSeries, onScan]);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch (e) {
      console.error("Error con linterna", e);
    }
  };

  const toggleZoom = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    
    // Cambiar zoom cíclicamente: 1x -> 2x -> 3x -> 1x
    let nextZoom = zoomLevel + 1;
    if (nextZoom > 3 || (capabilities.zoom && nextZoom > capabilities.zoom.max)) {
      nextZoom = 1;
    }

    try {
      await track.applyConstraints({ advanced: [{ zoom: nextZoom }] });
      setZoomLevel(nextZoom);
    } catch (e) {
      console.error("Error aplicando zoom", e);
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-4 bg-gray-900 rounded-2xl overflow-hidden p-4">
      
      {/* Botones de Control de Cámara */}
      <div className="flex flex-wrap gap-2 w-full max-w-sm justify-center mb-1">
        {/* Toggle Modo Ráfaga */}
        <button
          type="button"
          onClick={() => {
            const next = !burstMode;
            setBurstMode(next);
            burstModeRef.current = next;
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition active:scale-95 border ${
            burstMode
              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-500/30'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
          }`}
          title="Mantener la cámara abierta escaneando un equipo tras otro sin cerrarse"
        >
          <span className="text-sm">{burstMode ? '⚡' : '🔄'}</span>
          <span>{burstMode ? 'Ráfaga ACTIVA' : 'Activar Ráfaga'}</span>
          {burstMode && burstCount > 0 && (
            <span className="bg-slate-950 text-amber-300 px-1.5 py-0.2 rounded-full text-[10px] font-mono ml-0.5">
              {burstCount}
            </span>
          )}
        </button>

        {hasTorch && (
          <button 
            type="button"
            onClick={toggleTorch}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition active:scale-95 border ${
              torchOn 
                ? 'bg-yellow-400 text-yellow-950 border-yellow-300' 
                : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            Linterna
          </button>
        )}
        
        {hasZoom && (
          <button 
            type="button"
            onClick={toggleZoom}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs transition active:scale-95 border border-slate-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
            Zoom {zoomLevel}x
          </button>
        )}
      </div>

      <div className={`w-full max-w-sm relative rounded-2xl overflow-hidden border-2 transition-colors duration-200 shadow-xl bg-black aspect-video flex items-center justify-center ${
        flashSuccess
          ? 'border-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.9)]'
          : burstMode
          ? 'border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.4)]'
          : 'border-red-600'
      }`}>
        <video 
          ref={videoRef} 
          playsInline 
          autoPlay 
          muted 
          className="w-full h-full object-cover"
        />

        {/* Badge indicador de modo ráfaga en la parte superior */}
        {burstMode && (
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
            <span className="bg-amber-500/90 text-slate-950 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shadow">
              ⚡ Ráfaga Continua
            </span>
            <span className="bg-black/70 backdrop-blur-xs text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold">
              Leídos: {burstCount}
            </span>
          </div>
        )}
        
        {/* Flash visual de lectura exitosa */}
        {flashSuccess && (
          <div className="absolute inset-0 bg-emerald-500/25 pointer-events-none flex flex-col items-center justify-center z-20 animate-fade-in">
            <div className="bg-emerald-600/95 text-white px-3 py-1.5 rounded-xl font-mono font-black text-xs shadow-2xl flex items-center gap-1.5 border border-emerald-300">
              <span className="text-sm">✓</span>
              <span>¡LEÍDO: {lastDetected}!</span>
            </div>
          </div>
        )}

        {/* Guía visual para el QR */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className={`w-48 h-48 border-4 rounded-3xl shadow-[0_0_0_4000px_rgba(0,0,0,0.6)] flex items-center justify-center relative transition-colors duration-200 ${
            flashSuccess ? 'border-emerald-400' : burstMode ? 'border-amber-400/90' : 'border-red-500/80'
          }`}>
             <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl -m-1"></div>
             <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl -m-1"></div>
             <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl -m-1"></div>
             <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl -m-1"></div>
          </div>
        </div>
      </div>
      
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="text-center w-full">
        <p className="text-white font-bold mb-1">{status}</p>
        
        <div className="min-h-[2.5rem] flex flex-col items-center justify-center mb-4">
          {lastDetected ? (
            <>
              <p className="text-gray-400 text-xs">Información del QR:</p>
              <p className="text-yellow-400 text-[10px] font-mono break-all px-2 leading-tight">
                {lastDetected}
              </p>
            </>
          ) : (
            <p className="text-gray-400 text-sm px-4">Apunta la cámara al Código QR. Si te cuesta enfocar, usa el botón de Zoom.</p>
          )}
        </div>
        
        <button 
          onClick={handleCancelCallback}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full transition-colors w-full max-w-xs"
        >
          Cancelar / Usar Pistola
        </button>
      </div>
    </div>
  );
}
