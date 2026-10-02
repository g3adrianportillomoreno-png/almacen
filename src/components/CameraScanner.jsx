import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export default function CameraScanner({ expectedSeries, onScan, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const [status, setStatus] = useState('Iniciando cámara...');
  const [lastDetected, setLastDetected] = useState('');
  
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
        
        setStatus('Apuntando al Código QR...');

        const tick = async () => {
          if (!isActive || !videoRef.current || !canvasRef.current) return;
          
          const video = videoRef.current;
          
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            try {
              let qrText = null;

              // Intentar usar la API Nativa (súper rápida y precisa en móviles)
              if ('BarcodeDetector' in window) {
                const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code', 'data_matrix'] });
                const barcodes = await barcodeDetector.detect(video);
                if (barcodes.length > 0) {
                  qrText = barcodes[0].rawValue;
                }
              }

              // Si la API nativa no está o no detectó nada, usar jsQR como fallback
              if (!qrText) {
                const canvas = canvasRef.current;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: "dontInvert",
                });

                if (code) {
                  qrText = code.data;
                }
              }
              
              if (qrText) {
                qrText = qrText.trim().toUpperCase();
                setLastDetected(qrText);

                const parts = qrText.split(',');
                let extractedSerie = qrText;
                if (parts.length >= 2) {
                  extractedSerie = parts[1].trim(); 
                }

                setStatus('Código procesado...');
                isActive = false; 
                
                setTimeout(() => {
                  onScan(extractedSerie);
                }, 500);
                return; 
              }
            } catch (err) {
              console.warn("Error leyendo frame:", err);
            }
          }
          
          if (isActive) {
            requestAnimId = requestAnimationFrame(tick);
          }
        };

        requestAnimId = requestAnimationFrame(tick);

      } catch (err) {
        console.error("Error iniciando cámara:", err);
        setStatus('Error: No se pudo acceder a la cámara.');
      }
    };

    setupCamera();

    return () => {
      isActive = false;
      if (requestAnimId) cancelAnimationFrame(requestAnimId);
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
      <div className="flex gap-4 w-full max-w-sm justify-center mb-2">
        {hasTorch && (
          <button 
            onClick={toggleTorch}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${torchOn ? 'bg-yellow-400 text-yellow-900' : 'bg-gray-800 text-white'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            Linterna
          </button>
        )}
        
        {hasZoom && (
          <button 
            onClick={toggleZoom}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg font-bold text-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
            Zoom {zoomLevel}x
          </button>
        )}
      </div>

      <div className="w-full max-w-sm relative rounded-xl overflow-hidden border-2 border-red-600 shadow-xl bg-black aspect-video flex items-center justify-center">
        <video 
          ref={videoRef} 
          playsInline 
          autoPlay 
          muted 
          className="w-full h-full object-cover"
        />
        
        {/* Guía visual para el QR */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-48 h-48 border-4 border-red-500/80 rounded-3xl shadow-[0_0_0_4000px_rgba(0,0,0,0.6)] flex items-center justify-center relative">
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
          onClick={onCancel}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full transition-colors w-full max-w-xs"
        >
          Cancelar / Usar Pistola
        </button>
      </div>
    </div>
  );
}
