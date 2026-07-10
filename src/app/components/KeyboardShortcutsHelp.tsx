/**
 * KEYBOARD SHORTCUTS HELP MODAL
 * 
 * Shows all available keyboard shortcuts.
 * Triggered with Cmd/Ctrl + / or ?
 */

import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  LayoutDashboard,
  Brain,
  Users,
  Settings,
  Search,
  Filter,
  Command,
  Zap,
  Eye,
} from 'lucide-react';
import { useEscapeKey, isMac } from '@/app/hooks/useKeyboardShortcuts';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  useEscapeKey(onClose, isOpen);

  const mod = isMac() ? '⌘' : 'Ctrl';

  const shortcuts: Record<string, Shortcut[]> = {
    'General': [
      {
        keys: `${mod} K`,
        description: 'Open command palette',
        icon: Command,
      },
      {
        keys: `${mod} /`,
        description: 'Show keyboard shortcuts',
        icon: Eye,
      },
      {
        keys: 'ESC',
        description: 'Close modal/dialog',
      },
      {
        keys: '/',
        description: 'Focus search',
        icon: Search,
      },
    ],
    'Navigation': [
      {
        keys: `${mod} 1`,
        description: 'Go to Dashboard',
        icon: LayoutDashboard,
      },
      {
        keys: `${mod} 2`,
        description: 'Go to CORTEX',
        icon: Brain,
      },
      {
        keys: `${mod} 3`,
        description: 'Go to Team',
        icon: Users,
      },
      {
        keys: `${mod} 4`,
        description: 'Go to Settings',
        icon: Settings,
      },
      {
        keys: `${mod} B`,
        description: 'Toggle sidebar',
      },
    ],
    'Filters': [
      {
        keys: `${mod} Shift A`,
        description: 'Show all submissions',
        icon: Filter,
      },
      {
        keys: `${mod} Shift N`,
        description: 'Show new only',
      },
      {
        keys: `${mod} Shift R`,
        description: 'Show in review',
      },
      {
        keys: `${mod} Shift C`,
        description: 'Show completed',
      },
      {
        keys: `${mod} Shift P`,
        description: 'Show high priority',
        icon: Zap,
      },
    ],
    'Actions': [
      {
        keys: `${mod} A`,
        description: 'Approve selected',
      },
      {
        keys: `${mod} Enter`,
        description: 'Send report',
      },
      {
        keys: `${mod} Shift A`,
        description: 'Select all',
      },
      {
        keys: `${mod} D`,
        description: 'Deselect all',
      },
    ],
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-4xl bg-[#0A0A0F] border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                <Command className="size-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Keyboard Shortcuts</h2>
                <p className="text-sm text-gray-400">Power user navigation</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <X className="size-5 text-gray-400" />
            </button>
          </div>

          {/* Shortcuts Grid */}
          <div className="p-6 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-6">
              {Object.entries(shortcuts).map(([category, items]) => (
                <div key={category}>
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {items.map((shortcut, index) => {
                      const Icon = shortcut.icon;
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-black/40 border border-white/10 rounded-lg hover:border-[#8B5CF6]/30 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {Icon && <Icon className="size-4 text-gray-400" />}
                            <span className="text-sm text-white">{shortcut.description}</span>
                          </div>
                          <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-400 font-mono">
                            {shortcut.keys}
                          </kbd>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10 bg-black/40">
            <div className="flex items-center justify-between text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <div className="size-6 rounded bg-[#8B5CF6]/20 flex items-center justify-center">
                  <span className="text-xs font-bold text-[#8B5CF6]">💡</span>
                </div>
                <span>
                  Press <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded mx-1">ESC</kbd> to close
                </span>
              </div>
              <div>
                {Object.values(shortcuts).flat().length} shortcuts available
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
