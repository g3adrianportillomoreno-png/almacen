import { useState, useEffect, useCallback } from 'react';
import { OfflineSyncService } from '../services/OfflineSyncService.js';

/**
 * Hook para monitorear el estado de conexión a internet y las operaciones pendientes
 * en la cola de sincronización fuera de línea.
 */
export default function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(() => OfflineSyncService.isOnline());
  const [pendingCount, setPendingCount] = useState(() => OfflineSyncService.getPendingCount());
  const [isSyncing, setIsSyncing] = useState(() => OfflineSyncService.isSyncing);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  useEffect(() => {
    const handleSyncChange = (e) => {
      const detail = e?.detail || {};
      if (typeof detail.isOnline === 'boolean') setIsOnline(detail.isOnline);
      if (typeof detail.pendingCount === 'number') setPendingCount(detail.pendingCount);
      if (typeof detail.isSyncing === 'boolean') setIsSyncing(detail.isSyncing);
    };

    const handleSyncStart = () => {
      setIsSyncing(true);
    };

    const handleSyncEnd = (e) => {
      setIsSyncing(false);
      setPendingCount(OfflineSyncService.getPendingCount());
      if (e?.detail) {
        setLastSyncResult(e.detail);
        setTimeout(() => setLastSyncResult(null), 4000);
      }
    };

    const handleWindowOnline = () => setIsOnline(true);
    const handleWindowOffline = () => setIsOnline(false);

    window.addEventListener('cdm_offline_sync_change', handleSyncChange);
    window.addEventListener('cdm_offline_sync_start', handleSyncStart);
    window.addEventListener('cdm_offline_sync_end', handleSyncEnd);
    window.addEventListener('online', handleWindowOnline);
    window.addEventListener('offline', handleWindowOffline);

    // Actualización inicial
    setIsOnline(OfflineSyncService.isOnline());
    setPendingCount(OfflineSyncService.getPendingCount());
    setIsSyncing(OfflineSyncService.isSyncing);

    return () => {
      window.removeEventListener('cdm_offline_sync_change', handleSyncChange);
      window.removeEventListener('cdm_offline_sync_start', handleSyncStart);
      window.removeEventListener('cdm_offline_sync_end', handleSyncEnd);
      window.removeEventListener('online', handleWindowOnline);
      window.removeEventListener('offline', handleWindowOffline);
    };
  }, []);

  const syncNow = useCallback(async () => {
    return await OfflineSyncService.processQueue();
  }, []);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncResult,
    syncNow
  };
}
