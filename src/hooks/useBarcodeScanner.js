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
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current += e.key;

        // Limpiar el buffer si pasan más de 300ms sin teclas
        // Se aumenta a 300ms porque algunos escáneres bluetooth en Android son un poco más lentos entre tecla y tecla.
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          bufferRef.current = '';
        }, 300); 
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutRef.current);
    };
  }, [onScan]);
}
