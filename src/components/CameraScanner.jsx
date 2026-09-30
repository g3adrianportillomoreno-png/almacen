import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export default function CameraScanner({ expectedSeries, onScan, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('Iniciando cámara...');
  const [lastDetected, setLastDetected] = useState('');
  const streamRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    let requestAnimId = null;

    const setupCamera = async () => {
      try {
        setStatus('Solicitando permisos de cámara...');
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        
        if (!isActive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
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

        const tick = () => {
          if (!isActive || !videoRef.current || !canvasRef.current) return;
          
          const video = videoRef.current;
          
          // Esperar a que el video tenga dimensiones
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            // Dibujar el fotograma
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Extraer la información de píxeles
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            
            // Procesar con jsQR
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });
            
            if (code) {
              const qrText = code.data.trim().toUpperCase();
              setLastDetected(qrText);

              // Extraer el número de serie. Por el formato que enviaste (MX-M4071,95030569,CSPC...),
              // el número de serie está después de la primera coma.
              const parts = qrText.split(',');
              let extractedSerie = qrText;
              if (parts.length >= 2) {
                extractedSerie = parts[1].trim(); // Tomamos el elemento del medio
              }

              // Detener la cámara inmediatamente al leer un código
              setStatus('Código procesado...');
              isActive = false; 
              
              // Enviamos la serie leída a la vista principal. 
              // La vista principal decidirá si es un acierto (verde) o un error/inesperado (rojo)
              setTimeout(() => {
                onScan(extractedSerie);
              }, 500);
              return; // Salir del loop
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

  return (
    <div className="w-full flex flex-col items-center gap-4 bg-gray-900 rounded-2xl overflow-hidden p-4">
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
            <p className="text-gray-400 text-sm">Apunta la cámara al Código QR.</p>
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
