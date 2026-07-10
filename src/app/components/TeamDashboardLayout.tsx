/**
 * PERSISTENT TEAM DASHBOARD LAYOUT
 *
 * Two-layer pattern:
 *   TeamDashboardLayout  — mounts GlobalAIChatProvider, then delegates to DashboardLayoutInner
 *   DashboardLayoutInner — lives INSIDE the provider, safe to call useGlobalAIChat()
 */

import { useState, type ReactNode, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  Brain,
  Users,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  X,
  Search as SearchIcon,
  Shield,
  BarChart3,
  Mail,
  TrendingUp,
  Zap,
  GitBranch,
  Cpu,
} from 'lucide-react';
import { useDashboard } from '@/app/contexts/DashboardContext';
import { useKeyboardShortcuts, isMac } from '@/app/hooks/useKeyboardShortcuts';
import { CommandPalette, useCommandPaletteCommands } from '@/app/components/CommandPalette';
import { KeyboardShortcutsHelp } from '@/app/components/KeyboardShortcutsHelp';
import { NotificationCenter } from '@/app/components/NotificationCenter';
import { KanbanAlertToastStack } from '@/app/components/KanbanAlertToast';
import { GlobalAIChatProvider, useGlobalAIChat } from '@/app/contexts/GlobalAIChatContext';
import { GlobalAIChat } from '@/app/components/GlobalAIChat';
import { getDemoSubmissions } from '@/app/services/dataService';

// ── Shared types ───────────────────────────────────────────────────────────────

export interface Breadcrumb {
  label: string;
  onClick?: () => void;
}

export interface TeamDashboardLayoutProps {
  children: ReactNode;
  currentPage:
    | 'dashboard'
    | 'cortex'
    | 'team'
    | 'settings'
    | 'reviewer'
    | 'analytics'
    | 'emails'
    | 'revenue'
    | 'execution'
    | 'mapping'
    | 'architecture';
  breadcrumbs?: Breadcrumb[];
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onFocusSearch?: () => void;
  onOpenSubmission?: (id: string) => void;
  accessToken?: string;
  /** When set, auto-grounds the AI chat on this submission */
  activeSubmissionId?: string;
}

// ── Outer shell — only responsibility is mounting the provider ─────────────────

export function TeamDashboardLayout(props: TeamDashboardLayoutProps) {
  return (
    <GlobalAIChatProvider>
      <DashboardLayoutInner {...props} />
    </GlobalAIChatProvider>
  );
}

// ── Inner layout — safe to call useGlobalAIChat() here ────────────────────────

function DashboardLayoutInner({
  children,
  currentPage,
  breadcrumbs = [],
  onLogout,
  onNavigate,
  onFocusSearch,
  onOpenSubmission,
  accessToken,
  activeSubmissionId,
}: TeamDashboardLayoutProps) {
  // ── AI Chat context (safe — we are inside GlobalAIChatProvider) ────────────
  const { setAccessToken, setActiveLead } = useGlobalAIChat();

  useEffect(() => {
    setAccessToken(accessToken);
  }, [accessToken, setAccessToken]);

  useEffect(() => {
    if (!activeSubmissionId) return;
    const sub = getDemoSubmissions().find(s => s.id === activeSubmissionId);
    if (!sub) return;
    setActiveLead({
      id: sub.id,
      companyName: sub.company,
      contactName: sub.contact,
      industry: sub.industry,
      status: sub.status,
      priority: sub.priority,
      roiPotential: sub.roiPotential,
      qualityScore: sub.qualityScore,
      aiContext: {
        companyName: sub.company,
        industry: sub.industry,
        companySize: sub.employees,
        primaryPainSignal: `${sub.industry} business with ${sub.employees} employees — ROI potential ${sub.roiPotential}`,
        recommendedService: undefined,
        roiSummary: sub.roiPotential,
      },
    });
  }, [activeSubmissionId, setActiveLead]);

  // ── Dashboard context ──────────────────────────────────────────────────────
  const { state, setSidebarCollapsed, setActiveFilter, kanbanAlerts, markKanbanAlertsRead } =
    useDashboard();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sidebarCollapsed = state.viewPreferences.sidebarCollapsed;

  const handleFocusSearch = () => {
    searchInputRef.current?.focus();
    onFocusSearch?.();
  };

  const commands = useCommandPaletteCommands({
    onNavigate: page => onNavigate?.(page),
    onToggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
    onFocusSearch: handleFocusSearch,
    onSetFilter: filter => setActiveFilter(filter),
    submissions: state.searchableSubmissions,
    onOpenSubmission,
  });

  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'k',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Open command palette',
        action: () => setShowCommandPalette(true),
      },
      {
        key: '/',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Show keyboard shortcuts',
        action: () => setShowKeyboardHelp(true),
      },
      {
        key: '?',
        description: 'Show keyboard shortcuts',
        action: () => setShowKeyboardHelp(true),
      },
      {
        key: 'b',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Toggle sidebar',
        action: () => setSidebarCollapsed(!sidebarCollapsed),
      },
      {
        key: '1',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Dashboard',
        action: () => onNavigate?.('dashboard'),
      },
      {
        key: '2',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to CORTEX',
        action: () => onNavigate?.('cortex'),
      },
      {
        key: '3',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Team',
        action: () => onNavigate?.('team'),
      },
      {
        key: '4',
        meta: isMac(),
        ctrl: !isMac(),
        description: 'Go to Settings',
        action: () => onNavigate?.('settings'),
      },
    ],
  });

  const navItems = [
    { id: 'dashboard',  label: 'Dashboard',      icon: LayoutDashboard },
    { id: 'cortex',     label: 'CORTEX',          icon: Brain           },
    { id: 'analytics',  label: 'Analytics',       icon: BarChart3       },
    { id: 'revenue',    label: 'Rev Intel',       icon: TrendingUp      },
    { id: 'execution',  label: 'Execution',       icon: Zap             },
    { id: 'mapping',    label: 'Mapping Engine',  icon: GitBranch       },
    { id: 'reviewer',   label: 'Reviewer QA',     icon: Shield          },
    { id: 'emails',     label: 'Email Queue',     icon: Mail            },
    { id: 'team',       label: 'Team',            icon: Users           },
    { id: 'settings',   label: 'Settings',        icon: Settings        },
    { id: 'architecture', label: 'Architecture',  icon: Cpu             },
  ];

  return (
    <div className="flex h-screen bg-[#0A0A0F] text-white overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 80 : 280 }}
        className="bg-black/40 backdrop-blur-xl border-r border-white/10 flex flex-col"
      >
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3"
              >
                <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                  <Brain className="size-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">MARQ Cortex</h2>
                  <p className="text-xs text-gray-400">Internal Dashboard</p>
                </div>
              </motion.div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {sidebarCollapsed ? (
                <Menu className="size-5 text-gray-400" />
              ) : (
                <X className="size-5 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 text-white'
                    : 'hover:bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                <Icon className="size-5 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <span className="flex-1 text-left font-medium">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-white/10">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center font-bold">
                TU
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">Team User</p>
                <p className="text-xs text-gray-400 truncate">team@example.com</p>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all"
          >
            <LogOut className="size-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Logout</span>}
          </button>
        </div>
      </motion.aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-black/40 backdrop-blur-xl border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between">
            <nav className="flex items-center gap-2 text-sm">
              <button
                onClick={() => onNavigate?.('dashboard')}
                className="text-gray-400 hover:text-white transition-colors"
              >
                Dashboard
              </button>
              {breadcrumbs.map((crumb, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ChevronRight className="size-4 text-gray-500" />
                  {crumb.onClick ? (
                    <button
                      onClick={crumb.onClick}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="text-white font-medium">{crumb.label}</span>
                  )}
                </div>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <button
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                onClick={handleFocusSearch}
              >
                <SearchIcon className="size-5 text-gray-400" />
              </button>
              <NotificationCenter
                accessToken={accessToken}
                onNavigateToSubmission={() => onNavigate?.('cortex')}
                liveAlerts={kanbanAlerts}
                onMarkLiveRead={markKanbanAlertsRead}
              />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={commands}
      />
      <KeyboardShortcutsHelp
        isOpen={showKeyboardHelp}
        onClose={() => setShowKeyboardHelp(false)}
      />
      <KanbanAlertToastStack kanbanAlerts={kanbanAlerts} onNavigate={onNavigate} />

      {/* Global AI Chat — floating on every page */}
      <GlobalAIChat />
    </div>
  );
}