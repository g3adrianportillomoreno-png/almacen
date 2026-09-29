import { useEffect, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';

export default function CameraScanner({ expectedSeries, onScan, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('Iniciando cámara...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastDetected, setLastDetected] = useState('');
  const [isMirrored, setIsMirrored] = useState(false); // Nuevo: para webcams de PC
  const workerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    let intervalId = null;

    const setupCameraAndOCR = async () => {
      try {
        setStatus('Cargando motor de lectura (OCR)...');
        const worker = await createWorker('eng');
        if (!isActive) return;
        workerRef.current = worker;

        setStatus('Solicitando permisos de cámara...');
        // En PC, facingMode environment puede dar la cámara frontal.
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
        
        setStatus('Apuntando... (Analizando texto)');

        intervalId = setInterval(async () => {
          if (isProcessing || !videoRef.current || !canvasRef.current || !workerRef.current) return;
          if (videoRef.current.videoWidth === 0) return; // Evitar error si el video no ha cargado dimensiones
          
          setIsProcessing(true);
          const video = videoRef.current;
          const canvas = canvasRef.current;
          // Calculamos el área central para "recortar" la imagen (solo lo que está dentro del cuadro rojo)
          // Esto hace que la lectura sea ultra rápida y evite leer basura alrededor
          const cropWidth = video.videoWidth * 0.75; // 75% del ancho
          const cropHeight = Math.min(video.videoHeight * 0.4, 150); // área central
          const startX = (video.videoWidth - cropWidth) / 2;
          const startY = (video.videoHeight - cropHeight) / 2;
          
          canvas.width = cropWidth;
          canvas.height = cropHeight;

          // Si está en modo espejo (Webcam PC)
          if (isMirrored) {
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
          }
          
          // Dibujar SOLAMENTE el recorte central en el canvas
          context.drawImage(
            video, 
            startX, startY, cropWidth, cropHeight, // Coordenadas fuente (video original)
            0, 0, cropWidth, cropHeight            // Coordenadas destino (canvas)
          );
          
          try {
            const { data: { text } } = await workerRef.current.recognize(canvas);
            
            const cleanText = text.replace(/\s+/g, ' ').trim().toUpperCase();
            
            // Mostrar SIEMPRE lo que detecta, para saber que está trabajando
            if (cleanText.length > 0) {
              setLastDetected(cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText);
            } else {
              setLastDetected('(Sin texto visible)');
            }

            const foundSerie = expectedSeries.find(serie => cleanText.includes(serie.toUpperCase()));
            
            if (foundSerie && isActive) {
              setStatus(`¡Encontrado: ${foundSerie}!`);
              setLastDetected('');
              clearInterval(intervalId);
              
              setTimeout(() => {
                if (isActive) onScan(foundSerie);
              }, 1000);
            } else if (cleanText.length > 3 && isActive) {
              setStatus('No coincide. Sigue apuntando...');
            } else if (isActive) {
              setStatus('Buscando texto...');
            }
          } catch (err) {
            console.error("Error OCR:", err);
            setStatus('Error al leer imagen.');
          } finally {
            if (isActive) setIsProcessing(false);
          }
        }, 1500);

      } catch (err) {
        console.error("Error iniciando cámara/OCR:", err);
        setStatus('Error: No se pudo acceder a la cámara.');
      }
    };

    setupCameraAndOCR();

    return () => {
      isActive = false;
      if (intervalId) clearInterval(intervalId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [expectedSeries, onScan, isMirrored]); // Reinicia si cambiamos el modo espejo

  return (
    <div className="w-full flex flex-col items-center gap-4 bg-gray-900 rounded-2xl overflow-hidden p-4">
      
      {/* Botón para alternar Espejo (muy útil en PC) */}
      <button 
        onClick={() => setIsMirrored(!isMirrored)}
        className="bg-gray-800 text-gray-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-gray-700 transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
        {isMirrored ? 'Modo Normal' : 'Modo Espejo (PC)'}
      </button>

      <div className="w-full max-w-sm relative rounded-xl overflow-hidden border-2 border-red-600 shadow-xl bg-black aspect-video flex items-center justify-center">
        <video 
          ref={videoRef} 
          playsInline 
          autoPlay 
          muted 
          className="w-full h-full object-cover"
          style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
        />
        
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-3/4 h-24 border-2 border-red-500/50 rounded-lg shadow-[0_0_0_4000px_rgba(0,0,0,0.5)]"></div>
        </div>
      </div>
      
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="text-center w-full">
        <p className="text-white font-bold mb-1">{status}</p>
        
        <div className="min-h-[2.5rem] flex items-center justify-center mb-4">
          {lastDetected ? (
            <p className="text-yellow-400 text-xs font-mono break-all px-2">
              Viendo: "{lastDetected}"
            </p>
          ) : (
            <p className="text-gray-400 text-sm">Apunta la cámara al número de serie impreso.</p>
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
