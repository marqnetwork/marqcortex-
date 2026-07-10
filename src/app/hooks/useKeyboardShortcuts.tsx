/**
 * KEYBOARD SHORTCUTS SYSTEM
 * 
 * Professional keyboard shortcuts for power users:
 * - Cmd/Ctrl + K: Open command palette
 * - Cmd/Ctrl + /: Show shortcuts help
 * - Esc: Close modals/dialogs
 * - Cmd/Ctrl + B: Toggle sidebar
 * - Cmd/Ctrl + 1-4: Navigate between pages
 * - /: Focus search
 * - ?: Show help
 * 
 * Cross-platform support (Mac/Windows/Linux)
 */

import { useEffect, useCallback } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
  preventDefault?: boolean;
  enabled?: boolean;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: KeyboardShortcut[];
  enabled?: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      for (const shortcut of shortcuts) {
        // Skip if shortcut is disabled
        if (shortcut.enabled === false) continue;

        // Check if key matches
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        if (!keyMatches) continue;

        // Check modifiers
        const ctrlMatches = shortcut.ctrl ? event.ctrlKey : true;
        const metaMatches = shortcut.meta ? event.metaKey : true;
        const shiftMatches = shortcut.shift ? event.shiftKey : true;
        const altMatches = shortcut.alt ? event.altKey : true;

        // Must have modifier if specified
        const hasRequiredModifiers =
          (!shortcut.ctrl || event.ctrlKey) &&
          (!shortcut.meta || event.metaKey) &&
          (!shortcut.shift || event.shiftKey) &&
          (!shortcut.alt || event.altKey);

        if (
          keyMatches &&
          ctrlMatches &&
          metaMatches &&
          shiftMatches &&
          altMatches &&
          hasRequiredModifiers
        ) {
          // Special handling for search focus (/) - only if not in input
          if (shortcut.key === '/' && !isInputField) {
            if (shortcut.preventDefault !== false) {
              event.preventDefault();
            }
            shortcut.action();
            return;
          }

          // For shortcuts with modifiers, allow even in input fields
          if (shortcut.ctrl || shortcut.meta || shortcut.alt) {
            if (shortcut.preventDefault !== false) {
              event.preventDefault();
            }
            shortcut.action();
            return;
          }

          // For other shortcuts, skip if in input field
          if (isInputField) continue;

          if (shortcut.preventDefault !== false) {
            event.preventDefault();
          }
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get platform-specific modifier key label
 */
export function getModifierKey(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Check if running on Mac
 */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * Format keyboard shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.ctrl && !isMac()) parts.push('Ctrl');
  if (shortcut.meta && isMac()) parts.push('⌘');
  if (shortcut.meta && !isMac()) parts.push('Ctrl');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push(isMac() ? '⌥' : 'Alt');

  // Format key
  let key = shortcut.key;
  if (key === ' ') key = 'Space';
  if (key === 'Escape') key = 'Esc';
  if (key === 'ArrowUp') key = '↑';
  if (key === 'ArrowDown') key = '↓';
  if (key === 'ArrowLeft') key = '←';
  if (key === 'ArrowRight') key = '→';

  parts.push(key.length === 1 ? key.toUpperCase() : key);

  return parts.join(' + ');
}

/**
 * Global shortcuts configuration
 */
export const GLOBAL_SHORTCUTS = {
  COMMAND_PALETTE: { key: 'k', meta: true, ctrl: true },
  HELP: { key: '/', meta: true, ctrl: true },
  SEARCH: { key: '/' },
  TOGGLE_SIDEBAR: { key: 'b', meta: true, ctrl: true },
  ESCAPE: { key: 'Escape' },
  
  // Navigation
  NAV_DASHBOARD: { key: '1', meta: true, ctrl: true },
  NAV_CORTEX: { key: '2', meta: true, ctrl: true },
  NAV_TEAM: { key: '3', meta: true, ctrl: true },
  NAV_SETTINGS: { key: '4', meta: true, ctrl: true },
  
  // Quick actions
  QUICK_APPROVE: { key: 'a', meta: true, ctrl: true },
  QUICK_SEND: { key: 'Enter', meta: true, ctrl: true },
  
  // Selection
  SELECT_ALL: { key: 'a', meta: true, ctrl: true, shift: true },
  DESELECT_ALL: { key: 'd', meta: true, ctrl: true },
} as const;

/**
 * Hook for command palette shortcut
 */
export function useCommandPalette(onOpen: () => void) {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'k',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Open command palette',
        action: onOpen,
      },
    ],
  });
}

/**
 * Hook for escape key
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'Escape',
        description: 'Close',
        action: onEscape,
      },
    ],
    enabled,
  });
}

/**
 * Hook for search focus
 */
export function useSearchFocus(onFocus: () => void) {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: '/',
        description: 'Focus search',
        action: onFocus,
      },
    ],
  });
}
