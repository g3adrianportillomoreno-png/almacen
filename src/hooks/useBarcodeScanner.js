import { useEffect, useRef } from 'react';

export default function useBarcodeScanner(onScan) {
  const bufferRef = useRef('');
  const timeoutRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Evitar que el escáner abra la página de descargas (Ctrl + J) 
      // Muchos escáneres envían Ctrl+J en lugar de Enter.
      if (e.ctrlKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (bufferRef.current.trim() !== '') {
          onScan(bufferRef.current.trim());
          bufferRef.current = '';
        }
        return;
      }

      // Ignorar si el usuario está escribiendo en un input de texto o textarea
      // (por ejemplo, escribiendo comentarios en el checklist)
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        // Excepto si el usuario presiona Enter en el buscador manual
        return; 
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (bufferRef.current.trim() !== '') {
          onScan(bufferRef.current.trim());
          bufferRef.current = '';
        }
        return;
      }

      // Si es un caracter imprimible (letras, números, guiones)
      if (e.key.length === 1) {
        bufferRef.current += e.key;

        // Limpiar el buffer si pasan más de 100ms sin teclas (el escáner es muy rápido, el humano es lento)
        // Esto evita que pulsaciones sueltas se acumulen
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          bufferRef.current = '';
        }, 150); 
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutRef.current);
    };
  }, [onScan]);
}
