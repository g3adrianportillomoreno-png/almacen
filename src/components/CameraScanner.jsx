import { useEffect, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';

export default function CameraScanner({ expectedSeries, onScan, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('Iniciando cámara...');
  const [isProcessing, setIsProcessing] = useState(false);
  const workerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    let intervalId = null;

    const setupCameraAndOCR = async () => {
      try {
        // Inicializar Tesseract Worker para que sea más rápido
        setStatus('Cargando motor de lectura (OCR)...');
        const worker = await createWorker('eng');
        if (!isActive) return;
        workerRef.current = worker;

        // Iniciar Cámara trasera (environment)
        setStatus('Solicitando permisos de cámara...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
        
        if (!isActive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Esperar a que el video empiece a reproducirse
          await new Promise(resolve => {
            videoRef.current.onloadedmetadata = () => {
              videoRef.current.play().then(resolve);
            };
          });
        }
        
        setStatus('Apuntando... (Analizando texto)');

        // Bucle de lectura cada 1.5 segundos para no trabar el celular
        intervalId = setInterval(async () => {
          if (isProcessing || !videoRef.current || !canvasRef.current || !workerRef.current) return;
          
          setIsProcessing(true);
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          
          // Dibujar el fotograma actual en el canvas oculto
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          try {
            // Analizar la imagen con Tesseract
            const { data: { text } } = await workerRef.current.recognize(canvas);
            
            // Limpiar el texto: quitar espacios, saltos de línea innecesarios y pasarlo a mayúsculas
            const cleanText = text.replace(/\s+/g, ' ').toUpperCase();
            
            // Comprobar si ALGUNO de los números de serie esperados está dentro del texto detectado
            // Esto lo hace mucho más robusto que exigir una lectura 100% perfecta
            const foundSerie = expectedSeries.find(serie => cleanText.includes(serie.toUpperCase()));
            
            if (foundSerie && isActive) {
              setStatus(`¡Encontrado: ${foundSerie}!`);
              clearInterval(intervalId);
              
              // Pequeño delay para que el usuario vea que lo encontró
              setTimeout(() => {
                if (isActive) onScan(foundSerie);
              }, 1000);
            }
          } catch (err) {
            console.error("Error OCR:", err);
          } finally {
            if (isActive) setIsProcessing(false);
          }
        }, 1500);

      } catch (err) {
        console.error("Error iniciando cámara/OCR:", err);
        setStatus('Error: No se pudo acceder a la cámara o cargar el lector.');
      }
    };

    setupCameraAndOCR();

    // Cleanup: detener cámara y destruir worker cuando se cierra el componente
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
  }, [expectedSeries, onScan, isProcessing]);

  return (
    <div className="w-full flex flex-col items-center gap-4 bg-gray-900 rounded-2xl overflow-hidden p-4">
      <div className="w-full max-w-sm relative rounded-xl overflow-hidden border-2 border-red-600 shadow-xl bg-black aspect-video flex items-center justify-center">
        {/* Video feed */}
        <video 
          ref={videoRef} 
          playsInline 
          autoPlay 
          muted 
          className="w-full h-full object-cover"
        />
        
        {/* Overlay de marco (para ayudar al usuario a apuntar) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-3/4 h-24 border-2 border-red-500/50 rounded-lg shadow-[0_0_0_4000px_rgba(0,0,0,0.5)]"></div>
        </div>
      </div>
      
      {/* Canvas oculto para procesar la imagen */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="text-center w-full">
        <p className="text-white font-bold mb-1">{status}</p>
        <p className="text-gray-400 text-sm mb-4">Apunta la cámara al número de serie impreso.</p>
        
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
