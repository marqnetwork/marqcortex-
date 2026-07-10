/**
 * OFFLINE BANNER — Network status indicator
 *
 * Shows a sticky banner when the user loses connectivity,
 * and a brief "Back online" toast when they reconnect.
 * Uses Motion for smooth enter/exit animations.
 */

import { WifiOff, Wifi } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useOnlineStatus } from '@/app/hooks/useOnlineStatus';

export function OfflineBanner() {
  const { isOnline, justReconnected } = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-[#FD4438] to-[#FB923C] text-white text-sm font-semibold shadow-lg"
          role="alert"
          aria-live="assertive"
          style={{ fontFamily: 'Inter' }}
        >
          <WifiOff className="size-4 animate-pulse" />
          <span>You&apos;re offline. Some features may be unavailable.</span>
        </motion.div>
      )}

      {isOnline && justReconnected && (
        <motion.div
          key="reconnected"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-[#10B981] to-[#06D7F6] text-white text-sm font-semibold shadow-lg"
          role="status"
          aria-live="polite"
          style={{ fontFamily: 'Inter' }}
        >
          <Wifi className="size-4" />
          <span>Back online</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
