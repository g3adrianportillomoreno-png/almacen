import { supabase } from '../utils/supabaseClient.js';

/**
 * Servicio Centralizado de Sincronización en Tiempo Real Multi-Dispositivo (RealtimeSyncService)
 * 
 * Implementa la Alternativa 1:
 * 1. Difusión Directa Instantánea (Supabase Broadcast) para reflejar cambios en < 100ms.
 * 2. Suscripción a cambios en Postgres (postgres_changes) como respaldo.
 * 3. Detección de reactivación de pantalla / cambio de pestaña (visibilitychange y focus).
 * 4. Sondeo inteligente en segundo plano (Heartbeat Polling cada 8 segundos).
 */
class RealtimeSyncServiceImpl {
  constructor() {
    this.clientId = typeof window !== 'undefined'
      ? `client-${Math.random().toString(36).slice(2, 9)}-${Date.now()}`
      : 'server';

    this.channel = null;
    this.listeners = new Set();
    this.notificationListeners = new Set();
    this.lastRefreshTimestamp = 0;
    this.debounceTimer = null;
    this.pollingTimer = null;
    this.isInitialized = false;

    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  /**
   * Inicializa la conexión en tiempo real y detectores de visibilidad/red
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.setupChannel();
    this.setupVisibilityListeners();
    this.setupHeartbeatPolling();
  }

  /**
   * Configura el canal de WebSocket en Supabase (Broadcast + Postgres changes)
   */
  setupChannel() {
    try {
      if (this.channel) {
        try {
          supabase.removeChannel(this.channel);
        } catch {
          // ignore
        }
      }

      this.channel = supabase.channel('warehouse-realtime-sync', {
        config: {
          broadcast: { self: false } // No recibir nuestros propios broadcasts
        }
      });

      // 1. ESCUCHAR DIFUSIÓN DIRECTA (Broadcast Instantáneo entre celulares y computadoras)
      this.channel.on('broadcast', { event: 'INVENTORY_MUTATION' }, (payload) => {
        const data = payload?.payload || {};
        // Evitar procesar si vino del mismo cliente
        if (data.clientId === this.clientId) return;

        console.log('⚡ [RealtimeSync] Broadcast recibido de otro dispositivo:', data.type, data);

        // Si fue un archivo maestro o subida de checklist importante, notificar para toast visual
        if (data.type === 'MASTER_UPLOAD') {
          this.notifyAlert('✓ Se actualizó el Inventario Maestro con datos nuevos.');
        } else if (data.type === 'CHECKLIST_CREATED') {
          this.notifyAlert(`✓ Nuevo lote agregado: ${data.data?.name || data.data?.folio || 'Recepción'}`);
        } else if (data.type === 'CHECKLIST_MERGED') {
          this.notifyAlert('✓ Se fusionaron checklists en el sistema.');
        }

        this.triggerDebouncedSync(data);
      });

      // 2. ESCUCHAR CAMBIOS EN TABLAS DE POSTGRESQL (Respaldo nativo de Supabase)
      this.channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expected_series' },
        (payload) => {
          this.triggerDebouncedSync({ type: 'POSTGRES_EXPECTED_SERIES', payload });
        }
      );

      this.channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checklists' },
        (payload) => {
          this.triggerDebouncedSync({ type: 'POSTGRES_CHECKLISTS', payload });
        }
      );

      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📶 [RealtimeSync] Conectado exitosamente al canal en tiempo real.');
        }
      });
    } catch (err) {
      console.warn('⚠️ [RealtimeSync] No se pudo inicializar canal de WebSockets:', err);
    }
  }

  /**
   * Detecta cuando el operador desbloquea el celular, enciende la pantalla o vuelve a la pestaña
   */
  setupVisibilityListeners() {
    if (typeof window === 'undefined') return;

    const handleReactivation = () => {
      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      if (isVisible && navigator.onLine) {
        const now = Date.now();
        // Si pasaron más de 4 segundos desde la última actualización, refrescar de inmediato
        if (now - this.lastRefreshTimestamp > 4000) {
          console.log('📱 [RealtimeSync] Pantalla reactivada / ventana activa. Sincronizando datos...');
          this.triggerDebouncedSync({ type: 'VISIBILITY_RESUME' });
        }
      }
    };

    window.addEventListener('visibilitychange', handleReactivation);
    window.addEventListener('focus', handleReactivation);

    // Al reconectar internet/Wi-Fi
    window.addEventListener('online', () => {
      this.setupChannel();
      handleReactivation();
    });
  }

  /**
   * Sondeo periódico inteligente de fondo (cada 8 segundos mientras la pantalla esté activa)
   */
  setupHeartbeatPolling() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    this.pollingTimer = setInterval(() => {
      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      if (isVisible && typeof navigator !== 'undefined' && navigator.onLine) {
        const now = Date.now();
        // Solo sondeo si no se ha refrescado en los últimos 7 segundos
        if (now - this.lastRefreshTimestamp > 7000) {
          this.triggerDebouncedSync({ type: 'HEARTBEAT_POLL' });
        }
      }
    }, 8000);
  }

  /**
   * Emite una notificación de cambio a TODOS los demás dispositivos en tiempo real
   *
   * @param {string} mutationType 'ASSIGNMENT' | 'SCAN' | 'MASTER_UPLOAD' | 'CHECKLIST_CREATED' | 'BAJA_UPDATE' | 'CHECKLIST_MERGED'
   * @param {Object} data Metadatos adicionales (serie, lote, archivo, etc.)
   */
  async broadcastMutation(mutationType, data = {}) {
    this.lastRefreshTimestamp = Date.now();
    if (!this.channel) return;

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'INVENTORY_MUTATION',
        payload: {
          type: mutationType,
          data,
          clientId: this.clientId,
          timestamp: Date.now()
        }
      });
      console.log(`📡 [RealtimeSync] Difusión enviada a otros dispositivos: ${mutationType}`);
    } catch (e) {
      console.warn('⚠️ [RealtimeSync] Error enviando broadcast de sincronización:', e);
    }
  }

  /**
   * Ejecuta la actualización agrupando eventos rápidos (debounce de 250ms)
   */
  triggerDebouncedSync(eventInfo = {}) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.lastRefreshTimestamp = Date.now();
      this.listeners.forEach((fn) => {
        try {
          fn(eventInfo);
        } catch (e) {
          console.error('Error en listener de sincronización en tiempo real:', e);
        }
      });
    }, 250);
  }

  /**
   * Suscribe una función para que se ejecute cuando haya datos nuevos
   * @param {Function} callback (eventInfo) => void
   * @returns {Function} Función para desuscribirse
   */
  onSync(callback) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Suscribe una función para recibir avisos visuales (toasts / banners)
   */
  onNotification(callback) {
    this.notificationListeners.add(callback);
    return () => {
      this.notificationListeners.delete(callback);
    };
  }

  notifyAlert(message) {
    this.notificationListeners.forEach((fn) => {
      try {
        fn(message);
      } catch (e) {
        // ignore
      }
    });
  }
}

export const RealtimeSyncService = new RealtimeSyncServiceImpl();
export default RealtimeSyncService;
