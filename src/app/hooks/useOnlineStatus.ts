/**
 * USE ONLINE STATUS — Network connectivity hook
 *
 * Tracks navigator.onLine and fires callbacks on transitions.
 * Pairs with <OfflineBanner /> for user-visible status.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface OnlineStatusState {
  /** Current connectivity state */
  isOnline: boolean;
  /** True if we just came back online (auto-resets after 4s) */
  justReconnected: boolean;
  /** Timestamp of last disconnect (null if never disconnected) */
  lastDisconnectedAt: number | null;
  /** How long the last offline period lasted (ms), null if N/A */
  lastOfflineDuration: number | null;
}

export function useOnlineStatus(): OnlineStatusState {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const [lastDisconnectedAt, setLastDisconnectedAt] = useState<number | null>(null);
  const [lastOfflineDuration, setLastOfflineDuration] = useState<number | null>(null);
  const disconnectTimestamp = useRef<number | null>(null);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    setJustReconnected(true);

    if (disconnectTimestamp.current) {
      const duration = Date.now() - disconnectTimestamp.current;
      setLastOfflineDuration(duration);
      disconnectTimestamp.current = null;
    }

    // Clear the "just reconnected" flag after 4s
    setTimeout(() => setJustReconnected(false), 4000);
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setJustReconnected(false);
    const now = Date.now();
    disconnectTimestamp.current = now;
    setLastDisconnectedAt(now);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return { isOnline, justReconnected, lastDisconnectedAt, lastOfflineDuration };
}
