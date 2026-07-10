/**
 * COMMAND PALETTE
 * 
 * Spotify/VSCode-style command palette for quick navigation and actions.
 * Triggered with Cmd/Ctrl + K
 * 
 * Features:
 * - Fuzzy search
 * - Keyboard navigation (arrow keys, Enter)
 * - Categorized commands
 * - Recent actions
 * - Smart suggestions
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  LayoutDashboard,
  Brain,
  Users,
  Settings,
  FileText,
  Mail,
  Calendar,
  Check,
  Send,
  Filter,
  ArrowRight,
  Clock,
  Zap,
  Building2,
} from 'lucide-react';
import { useEscapeKey, formatShortcut, isMac } from '@/app/hooks/useKeyboardShortcuts';
import type { Submission } from '@/app/services/dataService';

// ============================================================================
// TYPES
// ============================================================================

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action: () => void;
  category: 'navigation' | 'actions' | 'filters' | 'recent' | 'submissions';
  keywords?: string[];
  shortcut?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEscapeKey(onClose, isOpen);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setSearchQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;

    const query = searchQuery.toLowerCase();
    return commands.filter((cmd) => {
      const labelMatch = cmd.label.toLowerCase().includes(query);
      const descMatch = cmd.description?.toLowerCase().includes(query);
      const keywordMatch = cmd.keywords?.some((k) => k.toLowerCase().includes(query));
      return labelMatch || descMatch || keywordMatch;
    });
  }, [commands, searchQuery]);

  // Group by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {
      recent: [],
      navigation: [],
      actions: [],
      filters: [],
      submissions: [],
    };

    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    });

    return groups;
  }, [filteredCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-start justify-center pt-[15vh]"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl bg-[#0A0A0F] border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
            <Search className="size-5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search commands..."
              className="flex-1 bg-transparent text-white placeholder:text-gray-400 outline-none text-lg"
            />
            <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-400">
              ESC
            </kbd>
          </div>

          {/* Commands List */}
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
            {filteredCommands.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                No commands found for "{searchQuery}"
              </div>
            ) : (
              <div className="p-2">
                {/* Recent */}
                {groupedCommands.recent.length > 0 && (
                  <CommandGroup
                    title="Recent"
                    icon={Clock}
                    commands={groupedCommands.recent}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => {
                      cmd.action();
                      onClose();
                    }}
                    startIndex={0}
                  />
                )}

                {/* Navigation */}
                {groupedCommands.navigation.length > 0 && (
                  <CommandGroup
                    title="Navigation"
                    icon={LayoutDashboard}
                    commands={groupedCommands.navigation}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => {
                      cmd.action();
                      onClose();
                    }}
                    startIndex={groupedCommands.recent.length}
                  />
                )}

                {/* Actions */}
                {groupedCommands.actions.length > 0 && (
                  <CommandGroup
                    title="Actions"
                    icon={Zap}
                    commands={groupedCommands.actions}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => {
                      cmd.action();
                      onClose();
                    }}
                    startIndex={
                      groupedCommands.recent.length + groupedCommands.navigation.length
                    }
                  />
                )}

                {/* Filters */}
                {groupedCommands.filters.length > 0 && (
                  <CommandGroup
                    title="Filters"
                    icon={Filter}
                    commands={groupedCommands.filters}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => {
                      cmd.action();
                      onClose();
                    }}
                    startIndex={
                      groupedCommands.recent.length +
                      groupedCommands.navigation.length +
                      groupedCommands.actions.length
                    }
                  />
                )}

                {/* Submissions — only when searching */}
                {searchQuery.trim().length > 0 && groupedCommands.submissions.length > 0 && (
                  <CommandGroup
                    title="Submissions"
                    icon={Building2}
                    commands={groupedCommands.submissions.slice(0, 6)}
                    selectedIndex={selectedIndex}
                    onSelect={(cmd) => {
                      cmd.action();
                      onClose();
                    }}
                    startIndex={
                      groupedCommands.recent.length +
                      groupedCommands.navigation.length +
                      groupedCommands.actions.length +
                      groupedCommands.filters.length
                    }
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-white/10 bg-black/40">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">↑</kbd>
                  <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">↓</kbd>
                  <span className="ml-1">Navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">↵</kbd>
                  <span className="ml-1">Select</span>
                </div>
              </div>
              <div>
                {filteredCommands.length} command{filteredCommands.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================================================
// COMMAND GROUP
// ============================================================================

function CommandGroup({
  title,
  icon: Icon,
  commands,
  selectedIndex,
  onSelect,
  startIndex,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  commands: Command[];
  selectedIndex: number;
  onSelect: (cmd: Command) => void;
  startIndex: number;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wide">
        <Icon className="size-3" />
        {title}
      </div>
      <div className="space-y-1">
        {commands.map((cmd, index) => {
          const globalIndex = startIndex + index;
          const isSelected = globalIndex === selectedIndex;
          const CmdIcon = cmd.icon;

          return (
            <motion.button
              key={cmd.id}
              onClick={() => onSelect(cmd)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all
                ${
                  isSelected
                    ? 'bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30'
                    : 'hover:bg-white/5'
                }
              `}
              whileHover={{ x: 2 }}
            >
              {CmdIcon && (
                <CmdIcon
                  className={`size-4 flex-shrink-0 ${
                    isSelected ? 'text-[#8B5CF6]' : 'text-gray-400'
                  }`}
                />
              )}
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-white">{cmd.label}</div>
                {cmd.description && (
                  <div className="text-xs text-gray-400">{cmd.description}</div>
                )}
              </div>
              {cmd.shortcut && (
                <kbd className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-400">
                  {cmd.shortcut}
                </kbd>
              )}
              {isSelected && <ArrowRight className="size-4 text-[#8B5CF6]" />}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to manage command palette state
 */
export function useCommandPaletteCommands({
  onNavigate,
  onToggleSidebar,
  onFocusSearch,
  onSetFilter,
  submissions = [],
  onOpenSubmission,
}: {
  onNavigate: (page: string) => void;
  onToggleSidebar: () => void;
  onFocusSearch: () => void;
  onSetFilter: (filter: string) => void;
  submissions?: Submission[];
  onOpenSubmission?: (id: string) => void;
}): Command[] {
  return useMemo(
    () => [
      // Navigation
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        description: 'View all submissions',
        icon: LayoutDashboard,
        action: () => onNavigate('dashboard'),
        category: 'navigation',
        keywords: ['home', 'submissions', 'list'],
        shortcut: `${isMac() ? '⌘' : 'Ctrl'} 1`,
      },
      {
        id: 'nav-cortex',
        label: 'Go to CORTEX',
        description: 'AI decision intelligence',
        icon: Brain,
        action: () => onNavigate('cortex'),
        category: 'navigation',
        keywords: ['ai', 'analysis', 'insights'],
        shortcut: `${isMac() ? '⌘' : 'Ctrl'} 2`,
      },
      {
        id: 'nav-team',
        label: 'Go to Team',
        description: 'Manage team members',
        icon: Users,
        action: () => onNavigate('team'),
        category: 'navigation',
        keywords: ['members', 'permissions'],
        shortcut: `${isMac() ? '⌘' : 'Ctrl'} 3`,
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        description: 'Configure preferences',
        icon: Settings,
        action: () => onNavigate('settings'),
        category: 'navigation',
        keywords: ['preferences', 'config'],
        shortcut: `${isMac() ? '⌘' : 'Ctrl'} 4`,
      },

      // Actions
      {
        id: 'action-search',
        label: 'Focus Search',
        description: 'Jump to search box',
        icon: Search,
        action: onFocusSearch,
        category: 'actions',
        keywords: ['find', 'filter'],
        shortcut: '/',
      },
      {
        id: 'action-sidebar',
        label: 'Toggle Sidebar',
        description: 'Show/hide sidebar',
        icon: LayoutDashboard,
        action: onToggleSidebar,
        category: 'actions',
        shortcut: `${isMac() ? '⌘' : 'Ctrl'} B`,
      },

      // Filters
      {
        id: 'filter-all',
        label: 'Show All Submissions',
        description: 'Clear all filters',
        icon: Filter,
        action: () => onSetFilter('All Submissions'),
        category: 'filters',
        keywords: ['reset', 'clear'],
      },
      {
        id: 'filter-new',
        label: 'Show New Only',
        description: 'Filter new submissions',
        icon: FileText,
        action: () => onSetFilter('New Only'),
        category: 'filters',
        keywords: ['fresh', 'recent'],
      },
      {
        id: 'filter-review',
        label: 'Show In Review',
        description: 'Filter in-review submissions',
        icon: Clock,
        action: () => onSetFilter('In Review'),
        category: 'filters',
        keywords: ['pending', 'processing'],
      },
      {
        id: 'filter-completed',
        label: 'Show Completed',
        description: 'Filter completed submissions',
        icon: Check,
        action: () => onSetFilter('Completed'),
        category: 'filters',
        keywords: ['done', 'finished'],
      },
      {
        id: 'filter-priority',
        label: 'Show High Priority',
        description: 'Filter high priority submissions',
        icon: Zap,
        action: () => onSetFilter('High Priority'),
        category: 'filters',
        keywords: ['urgent', 'important'],
      },

      // Submission search results (dynamic)
      ...submissions.map(sub => ({
        id: `sub-${sub.id}`,
        label: sub.company,
        description: `${sub.industry} · ${sub.status} · ${sub.email}`,
        icon: Building2,
        action: () => onOpenSubmission?.(sub.id),
        category: 'submissions' as const,
        keywords: [sub.company, sub.contact, sub.email, sub.industry, sub.status, sub.id],
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNavigate, onToggleSidebar, onFocusSearch, onSetFilter, submissions, onOpenSubmission],
  );
}