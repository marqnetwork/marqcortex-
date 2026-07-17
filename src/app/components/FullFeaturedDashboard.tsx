/**
 * FULL FEATURED DASHBOARD — Phase 4A
 *
 * Operations Efficiency upgrade:
 *   ✔ Multi-select with checkboxes (grid + list)
 *   ✔ Bulk action bar (status, priority, assign to me, export selected)
 *   ✔ Grid / List view toggle (persisted to context)
 *   ✔ Sort by Date / Score / Priority / Status (persisted)
 *   ✔ CSV export (all or selected)
 *   ✔ Assign to me / unassign
 *   ✔ All state wired to DashboardContext
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Filter, Mail, Building2, Calendar, ChevronDown,
  Eye, Check, Clock, TrendingUp, DollarSign, AlertCircle,
  RefreshCw, Loader2, ChevronUp, LayoutGrid, List,
  ArrowUpDown, Download, UserCheck, UserX, CheckSquare,
  Square, Minus, X, Zap, SortAsc, SortDesc, UserCircle,
} from 'lucide-react';
import {
  getSubmissions, updateSubmissionStatus, bulkUpdateSubmissions,
  getDemoSubmissions, type Submission,
} from '@/app/services/dataService';
import { useDashboard } from '@/app/contexts/DashboardContext';
import { SkeletonCardGrid, SkeletonTable } from '@/app/components/Skeletons';
import { FEATURES } from '@/config/features';
import { useDebounce } from '@/app/hooks/usePerformance';

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED_SUBMISSIONS: Submission[] = getDemoSubmissions();

// ── Status / priority palettes ────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  new:        { bg: 'bg-[#8B5CF6]/10', border: 'border-[#8B5CF6]/40', text: 'text-[#8B5CF6]', dot: 'bg-[#8B5CF6]' },
  'in-review':{ bg: 'bg-[#FB923C]/10', border: 'border-[#FB923C]/40', text: 'text-[#FB923C]', dot: 'bg-[#FB923C]' },
  completed:  { bg: 'bg-[#06D7F6]/10', border: 'border-[#06D7F6]/40', text: 'text-[#06D7F6]', dot: 'bg-[#06D7F6]' },
  approved:   { bg: 'bg-[#10B981]/10', border: 'border-[#10B981]/40', text: 'text-[#10B981]', dot: 'bg-[#10B981]' },
};

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  high:   { bg: 'bg-[#FD4438]/10', text: 'text-[#FD4438]' },
  medium: { bg: 'bg-[#FB923C]/10', text: 'text-[#FB923C]' },
  low:    { bg: 'bg-[#06D7F6]/10', text: 'text-[#06D7F6]' },
};

const STATUSES = ['new', 'in-review', 'completed', 'approved'] as Submission['status'][];
const PRIORITIES = ['high', 'medium', 'low'] as Submission['priority'][];

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportCSV(rows: Submission[], filename = 'submissions.csv') {
  const cols = [
    'ID', 'Company', 'Contact', 'Email', 'Phone', 'Website',
    'Industry', 'Employees', 'Revenue', 'Status', 'Priority',
    'Quality Score', 'AI Score', 'Completion Score', 'ROI Potential',
    'Assigned To', 'Submitted Date',
  ];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvContent = [
    cols.join(','),
    ...rows.map(s => [
      s.id, s.company, s.contact, s.email, s.phone, s.website,
      s.industry, s.employees, s.revenue, s.status, s.priority,
      s.qualityScore, s.aiScore, s.completionScore, s.roiPotential,
      s.assignedTo ?? '', s.submittedDate,
    ].map(escape).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onViewCortex: (submissionId: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
  onSubmissionSelect?: (id: string) => void;
  accessToken?: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export function FullFeaturedDashboard({ onViewCortex, searchInputRef, onSubmissionSelect, accessToken }: Props) {
  const {
    state,
    toggleSubmission, selectAllSubmissions, clearSelections,
    setSubmissionsView, setSortBy, setSortOrder,
    setSearchableSubmissions,
  } = useDashboard();

  const { selectedSubmissions, viewPreferences } = state;
  const { submissionsView, sortBy, sortOrder } = viewPreferences;

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Debounce the search — filter useMemo only re-runs 200 ms after typing stops
  // instead of on every keystroke. The input shows the live value immediately.
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  const [activeFilter, setActiveFilter] = useState('All');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu]     = useState(false);
  const [updatingId, setUpdatingId]         = useState<string | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkSuccess, setBulkSuccess]       = useState<string | null>(null);

  // Read current user name for "assign to me"
  const currentUserName = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('team_user') || '{}').name || 'Team Member'; }
    catch { return 'Team Member'; }
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadSubmissions = useCallback(async (silent = false) => {
    // If backend integration is disabled, use the persisted demo store. Reading
    // it fresh (not the module-level SEED_SUBMISSIONS constant) means newly
    // submitted questionnaires appear in the leads list.
    if (!FEATURES.BACKEND_INTEGRATION || !accessToken) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('📊 Using persisted demo store (backend integration disabled or no access token)');
      }
      const demoData = getDemoSubmissions();
      setSubmissions(demoData);
      setSearchableSubmissions(demoData);
      setIsLoading(false);
      return;
    }

    // Backend integration enabled - attempt to load from server
    if (!silent) setIsLoading(true); else setIsRefreshing(true);
    setError(null);
    
    try {
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('🔄 Loading submissions from backend...');
      }
      const result = await getSubmissions(accessToken);
      
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('✅ Submissions loaded:', result);
      }
      
      const data = result.submissions?.length ? result.submissions : SEED_SUBMISSIONS;
      setSubmissions(data);
      setSearchableSubmissions(data);
    } catch (err: any) {
      if (FEATURES.VERBOSE_LOGGING) {
        console.error('❌ Failed to load submissions:', err);
      }
      
      const errorMessage = err?.message || String(err);
      
      // Only show error UI if feature flag is enabled
      if (FEATURES.SHOW_API_ERRORS) {
        let displayError = 'Failed to load submissions from server';
        if (errorMessage.includes('Unauthorized')) {
          displayError = 'Authentication error: Please log in again.';
        } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
          displayError = 'Network error: Unable to connect to server.';
        } else if (errorMessage.includes('Database error')) {
          displayError = 'Database connection error: ' + errorMessage;
        }
        setError(displayError);
      }
      
      // Always fall back to demo data
      setSubmissions(SEED_SUBMISSIONS);
      setSearchableSubmissions(SEED_SUBMISSIONS);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [accessToken, setSearchableSubmissions]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  // ── Status change (single) ─────────────────────────────────────────────────

  const handleStatusChange = async (id: string, newStatus: Submission['status']) => {
    if (!accessToken) return;
    setUpdatingId(id);
    try {
      const result = await updateSubmissionStatus(id, accessToken, { status: newStatus });
      setSubmissions(prev => prev.map(s => s.id === id ? result.submission : s));
    } catch (err: any) {
      console.error('Failed to update status:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const handleBulk = async (updates: { status?: string; priority?: string; assignedTo?: string }) => {
    if (!accessToken || selectedSubmissions.length === 0) return;
    setIsBulkUpdating(true);
    try {
      await bulkUpdateSubmissions(selectedSubmissions, updates, accessToken);
      // Optimistic update
      setSubmissions(prev => prev.map(s =>
        selectedSubmissions.includes(s.id)
          ? { ...s, ...updates, status: (updates.status as Submission['status']) ?? s.status, priority: (updates.priority as Submission['priority']) ?? s.priority }
          : s
      ));
      const action = updates.status ? `→ ${updates.status}` : updates.priority ? `priority: ${updates.priority}` : updates.assignedTo !== undefined ? (updates.assignedTo ? `assigned to ${updates.assignedTo}` : 'unassigned') : '';
      setBulkSuccess(`${selectedSubmissions.length} updated ${action}`);
      setTimeout(() => { setBulkSuccess(null); clearSelections(); }, 2500);
    } catch (err: any) {
      console.error('Bulk update failed:', err);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // ── Filter + sort + search ─────────────────────────────────────────────────

  const processed = useMemo(() => {
    let list = submissions.filter(s => {
      const q = debouncedSearchQuery.toLowerCase();
      const matchSearch = !q || [s.company, s.email, s.contact, s.industry, s.assignedTo ?? '']
        .some(f => f.toLowerCase().includes(q));

      const matchFilter =
        activeFilter === 'All'          ? true :
        activeFilter === 'New'          ? s.status === 'new' :
        activeFilter === 'In Review'    ? s.status === 'in-review' :
        activeFilter === 'Completed'    ? s.status === 'completed' :
        activeFilter === 'Converted'    ? s.status === 'approved' :
        activeFilter === 'High Priority'? s.priority === 'high' :
        activeFilter === 'Assigned'     ? !!s.assignedTo :
        activeFilter === 'Unassigned'   ? !s.assignedTo : true;

      return matchSearch && matchFilter;
    });

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date')     cmp = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      if (sortBy === 'score')    cmp = a.qualityScore - b.qualityScore;
      if (sortBy === 'priority') {
        const p: Record<string, number> = { high: 3, medium: 2, low: 1 };
        cmp = (p[a.priority] ?? 0) - (p[b.priority] ?? 0);
      }
      if (sortBy === 'status') {
        const o: Record<string, number> = { new: 1, 'in-review': 2, completed: 3, approved: 4 };
        cmp = (o[a.status] ?? 0) - (o[b.status] ?? 0);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [submissions, debouncedSearchQuery, activeFilter, sortBy, sortOrder]);

  const stats = useMemo(() => ({
    total:       submissions.length,
    new:         submissions.filter(s => s.status === 'new').length,
    inReview:    submissions.filter(s => s.status === 'in-review').length,
    completed:   submissions.filter(s => s.status === 'completed').length,
    highPriority:submissions.filter(s => s.priority === 'high').length,
  }), [submissions]);

  // Select-all logic: if all visible are selected → deselect all, else select all
  const allVisibleSelected = processed.length > 0 && processed.every(s => selectedSubmissions.includes(s.id));
  const someSelected = selectedSubmissions.length > 0 && !allVisibleSelected;

  const handleSelectAll = () => {
    if (allVisibleSelected) clearSelections();
    else selectAllSubmissions(processed.map(s => s.id));
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" role="status" aria-label="Loading submissions">
        <SkeletonCardGrid count={4} />
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 pb-32">

      {/* ── Error banner ── */}
      {error && (
        <div className="p-4 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl text-sm text-[#FD4438] flex items-center justify-between">
          <span>⚠️ {error} — showing demo data</span>
          <button onClick={() => loadSubmissions()} className="underline text-xs">Retry</button>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', value: stats.total,        color: '#8B5CF6', filter: 'All' },
          { label: 'New',   value: stats.new,           color: '#8B5CF6', filter: 'New' },
          { label: 'In Review', value: stats.inReview,  color: '#FB923C', filter: 'In Review' },
          { label: 'Completed', value: stats.completed, color: '#06D7F6', filter: 'Completed' },
          { label: 'High Priority', value: stats.highPriority, color: '#FD4438', filter: 'High Priority' },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setActiveFilter(activeFilter === s.filter ? 'All' : s.filter)}
            className={`bg-black/40 border rounded-xl p-5 text-left transition-all hover:border-white/20 ${activeFilter === s.filter ? 'border-white/30 bg-white/5' : 'border-white/10'}`}
          >
            <div className="text-3xl font-bold mb-1" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-white/50">{s.label}</div>
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap gap-3 items-center">

        {/* Search */}
        <div className="flex-1 min-w-52 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search company, contact, email, industry…"
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-500 focus:border-[#8B5CF6]/50 outline-none transition-colors"
            ref={searchInputRef}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter pill */}
        <div className="relative">
          <button
            onClick={() => { setShowFilterMenu(!showFilterMenu); setShowSortMenu(false); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all ${activeFilter !== 'All' ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/40 text-[#8B5CF6]' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
          >
            <Filter className="size-4" />
            {activeFilter}
            <ChevronDown className="size-3.5" />
          </button>
          <AnimatePresence>
            {showFilterMenu && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute left-0 mt-1.5 w-44 bg-[#0d0d18] border border-white/15 rounded-xl shadow-2xl z-20 overflow-hidden py-1"
              >
                {['All', 'New', 'In Review', 'Completed', 'Converted', 'High Priority', 'Assigned', 'Unassigned'].map(f => (
                  <button key={f} onClick={() => { setActiveFilter(f); setShowFilterMenu(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeFilter === f ? 'text-[#8B5CF6] bg-[#8B5CF6]/10' : 'text-gray-300 hover:bg-white/5'}`}>
                    {f}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => { setShowSortMenu(!showSortMenu); setShowFilterMenu(false); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white hover:bg-white/10 transition-all"
          >
            {sortOrder === 'desc' ? <SortDesc className="size-4 text-gray-400" /> : <SortAsc className="size-4 text-gray-400" />}
            {sortBy === 'date' ? 'Date' : sortBy === 'score' ? 'Score' : sortBy === 'priority' ? 'Priority' : 'Status'}
            <ChevronDown className="size-3.5" />
          </button>
          <AnimatePresence>
            {showSortMenu && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute left-0 mt-1.5 w-48 bg-[#0d0d18] border border-white/15 rounded-xl shadow-2xl z-20 overflow-hidden py-1"
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-wider">Sort By</div>
                {([['date','Date'],['score','Quality Score'],['priority','Priority'],['status','Status']] as [string, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => { setSortBy(key as any); setShowSortMenu(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${sortBy === key ? 'text-[#8B5CF6] bg-[#8B5CF6]/10' : 'text-gray-300 hover:bg-white/5'}`}>
                    {label}
                  </button>
                ))}
                <div className="border-t border-white/10 mt-1 pt-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase tracking-wider">Direction</div>
                  {[['desc','Newest / Highest'],['asc','Oldest / Lowest']].map(([key, label]) => (
                    <button key={key} onClick={() => { setSortOrder(key as any); setShowSortMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${sortOrder === key ? 'text-[#8B5CF6] bg-[#8B5CF6]/10' : 'text-gray-300 hover:bg-white/5'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 p-1 bg-white/5 border border-white/10 rounded-xl">
          {(['list', 'grid'] as const).map(v => (
            <button key={v} onClick={() => setSubmissionsView(v)}
              className={`p-1.5 rounded-lg transition-all ${submissionsView === v ? 'bg-[#8B5CF6] text-white' : 'text-gray-500 hover:text-white'}`}>
              {v === 'list' ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button onClick={() => loadSubmissions(true)} disabled={isRefreshing}
          className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-all">
          <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Export All CSV */}
        <button onClick={() => exportCSV(processed, 'submissions-export.csv')}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-all">
          <Download className="size-4" />
          Export CSV
        </button>
      </div>

      {/* ── Results meta + select-all ── */}
      <div className="flex items-center gap-4">
        {/* Select-all checkbox */}
        {accessToken && (
          <button onClick={handleSelectAll} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <span className="size-4.5 flex items-center justify-center">
              {allVisibleSelected ? (
                <CheckSquare className="size-4.5 text-[#8B5CF6]" />
              ) : someSelected ? (
                <Minus className="size-4.5 text-[#8B5CF6]" />
              ) : (
                <Square className="size-4.5" />
              )}
            </span>
            {allVisibleSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
        <span className="text-white/50 text-sm ml-auto">
          Showing {processed.length} of {submissions.length}
          {debouncedSearchQuery && ` for "${debouncedSearchQuery}"`}
          {selectedSubmissions.length > 0 && (
            <span className="ml-2 text-[#8B5CF6] font-medium">· {selectedSubmissions.length} selected</span>
          )}
        </span>
        {!accessToken && (
          <span className="px-2 py-0.5 bg-[#FB923C]/20 border border-[#FB923C]/30 text-[#FB923C] text-xs rounded-full">
            Demo Data
          </span>
        )}
      </div>

      {/* ── Submissions ── */}
      {processed.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center size-20 rounded-full bg-white/5 mb-4">
            <Search className="size-10 text-white/20" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No submissions found</h3>
          <p className="text-white/40 text-sm">
            {searchQuery
              ? `No results for "${searchQuery}". Try a different search.`
              : 'No submissions match the current filter.'}
          </p>
        </div>
      ) : submissionsView === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {processed.map(sub => (
            <SubmissionGridCard
              key={sub.id}
              submission={sub}
              isSelected={selectedSubmissions.includes(sub.id)}
              onToggleSelect={() => accessToken && toggleSubmission(sub.id)}
              onViewCortex={() => onViewCortex(sub.id)}
              onStatusChange={handleStatusChange}
              isUpdating={updatingId === sub.id}
              canUpdate={!!accessToken}
            />
          ))}
        </div>
      ) : (
        <SubmissionListView
          submissions={processed}
          selectedIds={selectedSubmissions}
          onToggleSelect={id => accessToken && toggleSubmission(id)}
          onViewCortex={onViewCortex}
          onStatusChange={handleStatusChange}
          updatingId={updatingId}
          canUpdate={!!accessToken}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          BULK ACTION BAR — fixed bottom
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {selectedSubmissions.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-3xl w-[calc(100%-3rem)]"
          >
            <div className="bg-[#0d0d18]/95 backdrop-blur-xl border border-white/20 rounded-2xl px-5 py-3.5 shadow-2xl shadow-black/60 flex items-center gap-3 flex-wrap">

              {/* Count badge */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="size-6 rounded-full bg-[#8B5CF6] flex items-center justify-center text-xs font-bold text-white">
                  {selectedSubmissions.length}
                </div>
                <span className="text-sm font-semibold text-white">selected</span>
              </div>

              <div className="w-px h-6 bg-white/10 shrink-0" />

              {/* Success flash */}
              <AnimatePresence>
                {bulkSuccess && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[#10B981] text-sm font-medium flex items-center gap-1.5"
                  >
                    <Check className="size-4" /> {bulkSuccess}
                  </motion.span>
                )}
              </AnimatePresence>

              {!bulkSuccess && (
                <span className="contents">
                  {/* Move to status */}
                  <BulkDropdown
                    label="Move to…"
                    icon={<ChevronDown className="size-3.5" />}
                    disabled={isBulkUpdating}
                    items={STATUSES.map(s => ({
                      label: s.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase()),
                      action: () => handleBulk({ status: s }),
                    }))}
                  />

                  {/* Set priority */}
                  <BulkDropdown
                    label="Priority…"
                    icon={<ChevronDown className="size-3.5" />}
                    disabled={isBulkUpdating}
                    items={PRIORITIES.map(p => ({
                      label: p.charAt(0).toUpperCase() + p.slice(1),
                      action: () => handleBulk({ priority: p }),
                    }))}
                  />

                  {/* Assign to me */}
                  <button
                    onClick={() => handleBulk({ assignedTo: currentUserName })}
                    disabled={isBulkUpdating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8B5CF6]/15 hover:bg-[#8B5CF6]/25 border border-[#8B5CF6]/30 rounded-lg text-xs font-medium text-[#8B5CF6] transition-all disabled:opacity-50"
                  >
                    <UserCheck className="size-3.5" />
                    Assign to me
                  </button>

                  {/* Unassign */}
                  <button
                    onClick={() => handleBulk({ assignedTo: '' })}
                    disabled={isBulkUpdating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-all disabled:opacity-50"
                  >
                    <UserX className="size-3.5" />
                    Unassign
                  </button>

                  {/* Export selected */}
                  <button
                    onClick={() => exportCSV(submissions.filter(s => selectedSubmissions.includes(s.id)), 'selected-submissions.csv')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-all"
                  >
                    <Download className="size-3.5" />
                    Export ({selectedSubmissions.length})
                  </button>

                  {isBulkUpdating && <Loader2 className="size-4 text-[#8B5CF6] animate-spin" />}
                </span>
              )}

              {/* Clear */}
              <button onClick={clearSelections} className="ml-auto p-1.5 text-gray-500 hover:text-white transition-colors">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

// ── BulkDropdown ──────────────────────────────────────────────────────────────

function BulkDropdown({ label, icon, items, disabled }: {
  label: string;
  icon: React.ReactNode;
  items: { label: string; action: () => void }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-300 hover:text-white transition-all disabled:opacity-50"
      >
        {label} {icon}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute bottom-full left-0 mb-1.5 w-40 bg-[#0d0d18] border border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden py-1"
          >
            {items.map(item => (
              <button key={item.label} onClick={() => { item.action(); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-xs text-gray-300 hover:bg-white/8 hover:text-white transition-colors">
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Grid card ─────────────────────────────────────────────────────────────────

function SubmissionGridCard({
  submission, isSelected, onToggleSelect, onViewCortex, onStatusChange, isUpdating, canUpdate,
}: {
  submission: Submission;
  isSelected: boolean;
  onToggleSelect: () => void;
  onViewCortex: () => void;
  onStatusChange: (id: string, status: Submission['status']) => void;
  isUpdating: boolean;
  canUpdate: boolean;
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const st = STATUS_STYLE[submission.status] ?? STATUS_STYLE.new;
  const pr = PRIORITY_STYLE[submission.priority] ?? PRIORITY_STYLE.medium;

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      onClick={onViewCortex}
      className={`relative bg-black/40 border rounded-xl p-5 cursor-pointer transition-all group ${
        isSelected
          ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/5 shadow-lg shadow-[#8B5CF6]/10'
          : 'border-white/10 hover:border-[#8B5CF6]/30'
      }`}
    >
      {/* Checkbox */}
      {canUpdate && (
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
          className={`absolute top-3 left-3 z-10 transition-all ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {isSelected
            ? <CheckSquare className="size-4.5 text-[#8B5CF6]" />
            : <Square className="size-4.5 text-gray-500" />
          }
        </button>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3 pl-1">
        <div className="flex-1 min-w-0 pr-2">
          <h3 className="font-bold text-white text-base truncate group-hover:text-[#8B5CF6] transition-colors">{submission.company}</h3>
          <p className="text-xs text-white/50 truncate">{submission.contact}</p>
        </div>
        {/* Status badge */}
        <div className="relative shrink-0" onClick={e => { e.stopPropagation(); if (canUpdate) setShowStatusMenu(!showStatusMenu); }}>
          <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${st.bg} ${st.border} ${st.text} ${canUpdate ? 'cursor-pointer hover:opacity-80' : ''}`}>
            {isUpdating ? <Loader2 className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${st.dot}`} />}
            {submission.status.replace('-', ' ').toUpperCase()}
          </span>
          <AnimatePresence>
            {showStatusMenu && canUpdate && (
              <motion.div
                initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                className="absolute right-0 mt-1 w-36 bg-[#0d0d18] border border-white/20 rounded-xl shadow-2xl z-20 overflow-hidden py-1"
              >
                {STATUSES.map(s => (
                  <button key={s} onClick={e => { e.stopPropagation(); onStatusChange(submission.id, s); setShowStatusMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors ${submission.status === s ? 'text-[#8B5CF6]' : 'text-white'}`}>
                    {s.replace('-', ' ').toUpperCase()}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Mail className="size-3.5 shrink-0" />
          <span className="truncate">{submission.email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Building2 className="size-3.5 shrink-0" />
          <span className="truncate">{submission.industry}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Calendar className="size-3.5 shrink-0" />
          {submission.submittedDate}
        </div>
        {submission.assignedTo && (
          <div className="flex items-center gap-2 text-xs text-[#8B5CF6]/70">
            <UserCircle className="size-3.5 shrink-0" />
            <span className="truncate">{submission.assignedTo}</span>
          </div>
        )}
      </div>

      {/* Scores */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[['Q', submission.qualityScore], ['AI', submission.aiScore], ['✓', submission.completionScore]].map(([l, v]) => {
          const score = v as number;
          const col = score >= 90 ? '#10B981' : score >= 70 ? '#06D7F6' : '#FB923C';
          return (
            <div key={l} className="text-center">
              <div className="text-base font-bold" style={{ color: col }}>{score}</div>
              <div className="text-[10px] text-white/30">{l}</div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/8">
        <div className="flex items-center gap-1.5">
          <DollarSign className="size-3.5 text-[#10B981]" />
          <span className="text-xs font-semibold text-[#10B981]">{submission.roiPotential}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pr.bg} ${pr.text}`}>
          {submission.priority.toUpperCase()}
        </span>
      </div>

      {/* CORTEX button */}
      <button
        onClick={e => { e.stopPropagation(); onViewCortex(); }}
        className="w-full mt-3 py-2 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
      >
        <Eye className="size-3.5" />
        View in CORTEX
      </button>
    </motion.div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function SubmissionListView({
  submissions, selectedIds, onToggleSelect, onViewCortex, onStatusChange, updatingId, canUpdate,
}: {
  submissions: Submission[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onViewCortex: (id: string) => void;
  onStatusChange: (id: string, status: Submission['status']) => void;
  updatingId: string | null;
  canUpdate: boolean;
}) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[auto_1fr_140px_120px_100px_80px_80px_100px] gap-4 px-5 py-3 border-b border-white/8 text-[10px] font-bold text-gray-600 uppercase tracking-wider">
        <div className="w-5" />
        <div>Company</div>
        <div>Industry</div>
        <div>Status</div>
        <div>Priority</div>
        <div className="text-right">Q Score</div>
        <div className="text-right">ROI</div>
        <div className="text-right">Date</div>
      </div>

      <div className="divide-y divide-white/5">
        {submissions.map(sub => {
          const isSelected = selectedIds.includes(sub.id);
          const st = STATUS_STYLE[sub.status] ?? STATUS_STYLE.new;
          const pr = PRIORITY_STYLE[sub.priority] ?? PRIORITY_STYLE.medium;
          const scoreCol = sub.qualityScore >= 90 ? '#10B981' : sub.qualityScore >= 70 ? '#06D7F6' : '#FB923C';

          return (
            <motion.div
              key={sub.id}
              layout
              onClick={() => onViewCortex(sub.id)}
              className={`grid grid-cols-[auto_1fr_140px_120px_100px_80px_80px_100px] gap-4 px-5 py-3.5 cursor-pointer transition-all items-center group ${
                isSelected ? 'bg-[#8B5CF6]/8 border-l-2 border-[#8B5CF6]' : 'hover:bg-white/3 border-l-2 border-transparent'
              }`}
            >
              {/* Checkbox */}
              <div className="w-5 shrink-0">
                {canUpdate && (
                  <button
                    onClick={e => { e.stopPropagation(); onToggleSelect(sub.id); }}
                    className={`transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    {isSelected
                      ? <CheckSquare className="size-4 text-[#8B5CF6]" />
                      : <Square className="size-4 text-gray-600" />
                    }
                  </button>
                )}
              </div>

              {/* Company + contact */}
              <div className="min-w-0">
                <div className="font-semibold text-white text-sm truncate group-hover:text-[#8B5CF6] transition-colors">
                  {sub.company}
                  {sub.assignedTo && <span className="ml-2 text-[10px] text-[#8B5CF6]/60 font-normal">({sub.assignedTo})</span>}
                </div>
                <div className="text-xs text-gray-600 truncate">{sub.email}</div>
              </div>

              {/* Industry */}
              <div className="text-xs text-gray-400 truncate">{sub.industry}</div>

              {/* Status badge */}
              <div onClick={e => e.stopPropagation()}>
                <StatusBadgeInline
                  submission={sub}
                  onStatusChange={onStatusChange}
                  isUpdating={updatingId === sub.id}
                  canUpdate={canUpdate}
                />
              </div>

              {/* Priority */}
              <div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pr.bg} ${pr.text}`}>
                  {sub.priority.toUpperCase()}
                </span>
              </div>

              {/* Q Score */}
              <div className="text-right text-sm font-bold" style={{ color: scoreCol }}>
                {sub.qualityScore}
              </div>

              {/* ROI */}
              <div className="text-right text-xs text-[#10B981] font-semibold">{sub.roiPotential}</div>

              {/* Date */}
              <div className="text-right text-xs text-gray-600">{sub.submittedDate}</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadgeInline({ submission, onStatusChange, isUpdating, canUpdate }: {
  submission: Submission;
  onStatusChange: (id: string, status: Submission['status']) => void;
  isUpdating: boolean;
  canUpdate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const st = STATUS_STYLE[submission.status] ?? STATUS_STYLE.new;
  return (
    <div className="relative">
      <button
        onClick={() => canUpdate && setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${st.bg} ${st.border} ${st.text} ${canUpdate ? 'hover:opacity-80 cursor-pointer' : ''}`}
      >
        {isUpdating ? <Loader2 className="size-2.5 animate-spin" /> : <span className={`size-1.5 rounded-full ${st.dot}`} />}
        {submission.status.replace('-', ' ').toUpperCase()}
      </button>
      <AnimatePresence>
        {open && canUpdate && (
          <motion.div
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
            className="absolute left-0 mt-1 w-36 bg-[#0d0d18] border border-white/20 rounded-xl shadow-2xl z-30 overflow-hidden py-1"
          >
            {STATUSES.map(s => (
              <button key={s} onClick={() => { onStatusChange(submission.id, s); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors ${submission.status === s ? 'text-[#8B5CF6]' : 'text-white'}`}>
                {s.replace('-', ' ').toUpperCase()}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}