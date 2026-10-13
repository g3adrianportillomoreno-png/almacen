/**
 * Utilidad de Efectos de Sonido Hápticos y Auditivos para Escaneo de Almacén
 * Utiliza la Web Audio API nativa para generar tonos industriales precisos
 * sin necesidad de archivos MP3 externos, con latencia cero y soporte 100% offline.
 */

let audioCtx = null;

// Obtener o inicializar el contexto de audio de forma diferida (lazy)
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Comprobar si los sonidos están silenciados por el usuario
export function isSoundMuted() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('warehouse_sound_muted') === 'true';
}

// Activar o desactivar sonido
export function toggleSoundMute() {
  const current = isSoundMuted();
  const next = !current;
  localStorage.setItem('warehouse_sound_muted', String(next));
  return next;
}

/**
 * 1. SONIDO DE ÉXITO (Bip nítido de pistola Zebra / Honeywell)
 * Se reproduce cuando una serie es leída y encontrada correctamente en la lista.
 */
export function playScanSuccess() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Salto rápido de frecuencia para un "bip" nítido de alta precisión
    osc.frequency.setValueAtTime(1450, now);
    osc.frequency.exponentialRampToValueAtTime(1850, now + 0.08);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);

    // Vibración corta de confirmación en móviles
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
  } catch (err) {
    console.warn("Audio feedback error:", err);
  }
}

/**
 * 2. SONIDO DE SERIE DUPLICADA (Doble tono medio-bajo de advertencia)
 * Se reproduce cuando el equipo ya había sido escaneado previamente.
 */
export function playScanDuplicate() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    
    // Primer pulso
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(480, now);
    gain1.gain.setValueAtTime(0.22, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.07);

    // Segundo pulso más bajo
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(360, now + 0.09);
    gain2.gain.setValueAtTime(0.22, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.17);

    // Vibración doble de advertencia
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([70, 40, 70]);
    }
  } catch (err) {
    console.warn("Audio feedback error:", err);
  }
}

/**
 * 3. SONIDO DE ERROR / NO ENCONTRADO (Zumbido grave de rechazo)
 * Se reproduce cuando la serie no pertenece al checklist o lote.
 */
export function playScanError() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Onda diente de sierra para un tono de "buzz" áspero inconfundible
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.linearRampToValueAtTime(140, now + 0.22);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.23);

    // Vibración larga de error
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([160, 50, 160]);
    }
  } catch (err) {
    console.warn("Audio feedback error:", err);
  }
}

/**
 * 4. SONIDO DE UBICACIÓN ASIGNADA (Campana doble ascendente agradable)
 * Se reproduce cuando el operador guarda la Fila y Espacio de un equipo.
 */
export function playLocationAssigned() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Nota 1 (G5 - 784 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(784, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.08);

    // Nota 2 (C6 - 1046 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046, now + 0.07);
    gain2.gain.setValueAtTime(0.22, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.07);
    osc2.stop(now + 0.22);

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([50, 30, 80]);
    }
  } catch (err) {
    console.warn("Audio feedback error:", err);
  }
}

/**
 * 5. SONIDO DE CHECKLIST COMPLETADO (Fanfarria arpegio de celebración)
 * Se reproduce cuando el lote llega al 100% de equipos leídos.
 */
export function playChecklistCompleted() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const notes = [
      { freq: 523.25, time: 0.00, dur: 0.09 }, // Do (C5)
      { freq: 659.25, time: 0.09, dur: 0.09 }, // Mi (E5)
      { freq: 783.99, time: 0.18, dur: 0.09 }, // Sol (G5)
      { freq: 1046.50, time: 0.27, dur: 0.35 } // Do agudo (C6)
    ];

    const now = ctx.currentTime;
    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.time);

      gain.gain.setValueAtTime(0.25, now + n.time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.time);
      osc.stop(now + n.time + n.dur);
    });

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([80, 50, 80, 50, 200]);
    }
  } catch (err) {
    console.warn("Audio feedback error:", err);
  }
}

export const soundEffects = {
  playScanSuccess,
  playScanDuplicate,
  playScanError,
  playLocationAssigned,
  playChecklistCompleted,
  isSoundMuted,
  toggleSoundMute
};

export default soundEffects;
