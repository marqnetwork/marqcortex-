/**
 * DASHBOARD CONTEXT - STATE PERSISTENCE
 * 
 * This context preserves dashboard state across navigation:
 * - Search queries
 * - Active filters
 * - Selected submissions
 * - Scroll positions
 * - View preferences
 * 
 * All state is automatically saved to localStorage and restored on mount.
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import type { Submission } from '@/app/services/dataService';

// ============================================================================
// KANBAN ALERT TYPES (12A)
// ============================================================================

export type KanbanAlertKind     = 'remote_move' | 'score_low' | 'score_high' | 'conflict' | 'stale_escalation';
export type KanbanAlertSeverity = 'info' | 'warning' | 'critical';

export interface KanbanAlert {
  id:          string;
  kind:        KanbanAlertKind;
  severity:    KanbanAlertSeverity;
  title:       string;
  body:        string;
  leadId:      string;
  companyName: string;
  at:          string; // ISO timestamp
  read:        boolean;
}

// ============================================================================
// TYPES
// ============================================================================

interface DashboardState {
  // Search & Filters
  searchQuery: string;
  activeFilter: string;
  
  // Selections
  selectedSubmissions: string[];
  
  // Scroll Positions
  scrollPositions: {
    [page: string]: number;
  };
  
  // CORTEX State
  cortexState: {
    view: 'overview' | 'detail' | 'insights';
    leadId?: string;
    selectedLeadId?: string;
  };
  
  // View Preferences
  viewPreferences: {
    sidebarCollapsed: boolean;
    submissionsView: 'grid' | 'list';
    sortBy: 'date' | 'priority' | 'status' | 'score';
    sortOrder: 'asc' | 'desc';
  };

  // Cached submissions for global search
  searchableSubmissions: Submission[];
}

interface DashboardContextType {
  state: DashboardState;
  
  // Search & Filters
  setSearchQuery: (query: string) => void;
  setActiveFilter: (filter: string) => void;
  
  // Selections
  toggleSubmission: (id: string) => void;
  selectAllSubmissions: (ids: string[]) => void;
  clearSelections: () => void;
  
  // Scroll Positions
  saveScrollPosition: (page: string, position: number) => void;
  getScrollPosition: (page: string) => number;
  
  // CORTEX State
  setCortexState: (state: Partial<DashboardState['cortexState']>) => void;
  
  // View Preferences
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSubmissionsView: (view: 'grid' | 'list') => void;
  setSortBy: (sortBy: 'date' | 'priority' | 'status' | 'score') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;

  // Searchable submissions cache
  setSearchableSubmissions: (submissions: Submission[]) => void;
  
  // Reset
  resetState: () => void;

  // 12A: Kanban live alerts (transient — not persisted to localStorage)
  kanbanAlerts:         KanbanAlert[];
  pushKanbanAlert:      (alert: Omit<KanbanAlert, 'id' | 'at' | 'read'>) => void;
  clearKanbanAlerts:    () => void;
  markKanbanAlertsRead: () => void;
}

// ============================================================================
// DEFAULT STATE
// ============================================================================

const defaultState: DashboardState = {
  searchQuery: '',
  activeFilter: 'All Submissions',
  selectedSubmissions: [],
  scrollPositions: {},
  cortexState: {
    view: 'overview',
  },
  viewPreferences: {
    sidebarCollapsed: false,
    submissionsView: 'list',
    sortBy: 'date',
    sortOrder: 'desc',
  },
  searchableSubmissions: [],
};

// ============================================================================
// CONTEXT
// ============================================================================

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(() => {
    // Try to restore state from localStorage on mount
    try {
      const saved = localStorage.getItem('dashboard_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        // searchableSubmissions is transient — never restored from localStorage
        return { ...defaultState, ...parsed, searchableSubmissions: [] };
      }
    } catch (error) {
      console.warn('Failed to restore dashboard state:', error);
    }
    return defaultState;
  });

  // 12A: Kanban live alerts — transient, not persisted
  const [kanbanAlerts, setKanbanAlerts] = useState<KanbanAlert[]>([]);

  // Save state to localStorage — debounced 400ms to avoid hammering storage on
  // every keystroke / scroll update. searchableSubmissions is excluded: it is
  // transient cache (potentially many KB) and is always re-fetched on mount.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const { searchableSubmissions: _omit, ...persistable } = state;
        localStorage.setItem('dashboard_state', JSON.stringify(persistable));
      } catch (error) {
        console.warn('Failed to save dashboard state:', error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [state]);

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  const setActiveFilter = useCallback((filter: string) => {
    setState((prev) => ({ ...prev, activeFilter: filter }));
  }, []);

  const toggleSubmission = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      selectedSubmissions: prev.selectedSubmissions.includes(id)
        ? prev.selectedSubmissions.filter((sid) => sid !== id)
        : [...prev.selectedSubmissions, id],
    }));
  }, []);

  const selectAllSubmissions = useCallback((ids: string[]) => {
    setState((prev) => ({ ...prev, selectedSubmissions: ids }));
  }, []);

  const clearSelections = useCallback(() => {
    setState((prev) => ({ ...prev, selectedSubmissions: [] }));
  }, []);

  const saveScrollPosition = useCallback((page: string, position: number) => {
    setState((prev) => ({
      ...prev,
      scrollPositions: {
        ...prev.scrollPositions,
        [page]: position,
      },
    }));
  }, []);

  const getScrollPosition = useCallback((page: string): number => {
    return state.scrollPositions[page] || 0;
  }, [state.scrollPositions]);

  const setCortexState = useCallback((newState: Partial<DashboardState['cortexState']>) => {
    setState((prev) => ({
      ...prev,
      cortexState: {
        ...prev.cortexState,
        ...newState,
      },
    }));
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({
      ...prev,
      viewPreferences: {
        ...prev.viewPreferences,
        sidebarCollapsed: collapsed,
      },
    }));
  }, []);

  const setSubmissionsView = useCallback((view: 'grid' | 'list') => {
    setState((prev) => ({
      ...prev,
      viewPreferences: {
        ...prev.viewPreferences,
        submissionsView: view,
      },
    }));
  }, []);

  const setSortBy = useCallback((sortBy: 'date' | 'priority' | 'status' | 'score') => {
    setState((prev) => ({
      ...prev,
      viewPreferences: {
        ...prev.viewPreferences,
        sortBy,
      },
    }));
  }, []);

  const setSortOrder = useCallback((order: 'asc' | 'desc') => {
    setState((prev) => ({
      ...prev,
      viewPreferences: {
        ...prev.viewPreferences,
        sortOrder: order,
      },
    }));
  }, []);

  const setSearchableSubmissions = useCallback((submissions: Submission[]) => {
    setState((prev) => ({ ...prev, searchableSubmissions: submissions }));
  }, []);

  const resetState = useCallback(() => {
    setState(defaultState);
    localStorage.removeItem('dashboard_state');
  }, []);

  // 12A: Alert actions
  const pushKanbanAlert = useCallback((alert: Omit<KanbanAlert, 'id' | 'at' | 'read'>) => {
    setKanbanAlerts(prev => [{
      ...alert,
      id:   `${alert.kind}:${alert.leadId}:${Date.now()}`,
      at:   new Date().toISOString(),
      read: false,
    }, ...prev].slice(0, 50)); // keep at most 50 live alerts
  }, []);

  const clearKanbanAlerts    = useCallback(() => setKanbanAlerts([]), []);
  const markKanbanAlertsRead = useCallback(() =>
    setKanbanAlerts(prev => prev.map(a => ({ ...a, read: true }))), []);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const value: DashboardContextType = useMemo(() => ({
    state,
    setSearchQuery,
    setActiveFilter,
    toggleSubmission,
    selectAllSubmissions,
    clearSelections,
    saveScrollPosition,
    getScrollPosition,
    setCortexState,
    setSidebarCollapsed,
    setSubmissionsView,
    setSortBy,
    setSortOrder,
    setSearchableSubmissions,
    resetState,
    // 12A
    kanbanAlerts,
    pushKanbanAlert,
    clearKanbanAlerts,
    markKanbanAlertsRead,
  }), [
    state,
    setSearchQuery, setActiveFilter,
    toggleSubmission, selectAllSubmissions, clearSelections,
    saveScrollPosition, getScrollPosition,
    setCortexState,
    setSidebarCollapsed, setSubmissionsView, setSortBy, setSortOrder,
    setSearchableSubmissions, resetState,
    kanbanAlerts, pushKanbanAlert, clearKanbanAlerts, markKanbanAlertsRead,
  ]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    // During hot module reload, context might temporarily be undefined
    // Return a temporary safe value to prevent crashes
    console.warn('useDashboard called outside of DashboardProvider - using defaults');
    
    // Return a dummy context that won't crash the app
    return {
      state: defaultState,
      setSearchQuery: () => {},
      setActiveFilter: () => {},
      toggleSubmission: () => {},
      selectAllSubmissions: () => {},
      clearSelections: () => {},
      saveScrollPosition: () => {},
      getScrollPosition: () => 0,
      setCortexState: () => {},
      setSidebarCollapsed: () => {},
      setSubmissionsView: () => {},
      setSortBy: () => {},
      setSortOrder: () => {},
      setSearchableSubmissions: () => {},
      resetState: () => {},
      kanbanAlerts: [],
      pushKanbanAlert: () => {},
      clearKanbanAlerts: () => {},
      markKanbanAlertsRead: () => {},
    } as DashboardContextType;
  }
  return context;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Custom hook to save scroll position on unmount and restore on mount
 */
export function useScrollRestoration(pageKey: string) {
  const { saveScrollPosition, getScrollPosition } = useDashboard();
  // Track scroll position in a ref — avoids triggering context state updates
  // on every scroll pixel. Only flushes to context state on unmount.
  const pendingScrollY = useRef<number>(0);

  useEffect(() => {
    // Restore scroll position on mount
    const savedPosition = getScrollPosition(pageKey);
    if (savedPosition > 0) {
      setTimeout(() => {
        window.scrollTo(0, savedPosition);
      }, 100);
    }

    // Accumulate scroll position in ref — no re-renders
    const handleScroll = () => {
      pendingScrollY.current = window.scrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      // Flush final position to context on unmount (once per navigation)
      if (pendingScrollY.current > 0) {
        saveScrollPosition(pageKey, pendingScrollY.current);
      }
    };
  }, [pageKey, saveScrollPosition, getScrollPosition]);
}

/**
 * Auto-save helper for form inputs
 */
export function useAutoSave<T>(
  key: string,
  value: T,
  delay: number = 500
) {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`autosave_${key}`, JSON.stringify(value));
      } catch (error) {
        console.warn('Failed to auto-save:', error);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [key, value, delay]);
}

/**
 * Restore auto-saved value
 */
export function useAutoRestore<T>(key: string, defaultValue: T): T {
  const [value] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`autosave_${key}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.warn('Failed to restore auto-saved value:', error);
    }
    return defaultValue;
  });

  return value;
}