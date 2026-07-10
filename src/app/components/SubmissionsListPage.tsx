/**
 * SUBMISSIONS LIST PAGE (Content Only)
 * 
 * This is the main submissions list view without the shell.
 * It will be wrapped by TeamDashboardLayout.
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Search,
  Filter,
  Mail,
  Building2,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { QuickActions, BatchActions } from '@/app/components/QuickActions';
import { useDashboard, useScrollRestoration } from '@/app/contexts/DashboardContext';

interface SubmissionsListPageProps {
  onViewCortex: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

interface Submission {
  id: string;
  company: string;
  email: string;
  industry: string;
  employees: string;
  revenue: string;
  submittedDate: string;
  status: 'new' | 'in-review' | 'completed' | 'approved';
  priority: 'high' | 'medium' | 'low';
  completionScore: number;
  qualityScore?: number;
}

const sampleSubmissions: Submission[] = [
  {
    id: '1',
    company: 'TechCorp Solutions',
    email: 'contact@techcorp.io',
    industry: 'Technology',
    employees: '51-200',
    revenue: '$1M - $5M',
    submittedDate: 'Jan 27, 2026',
    status: 'new',
    priority: 'high',
    completionScore: 95,
    qualityScore: 94,
  },
  {
    id: '2',
    company: 'HealthFirst Medical',
    email: 'info@healthfirst.com',
    industry: 'Healthcare',
    employees: '11-50',
    revenue: '$500K - $1M',
    submittedDate: 'Jan 26, 2026',
    status: 'in-review',
    priority: 'high',
    completionScore: 88,
    qualityScore: 90,
  },
  {
    id: '3',
    company: 'RetailMax Inc',
    email: 'hello@retailmax.com',
    industry: 'Retail',
    employees: '201-500',
    revenue: '$5M - $10M',
    submittedDate: 'Jan 25, 2026',
    status: 'new',
    priority: 'medium',
    completionScore: 92,
    qualityScore: 85,
  },
  {
    id: '4',
    company: 'CloudServe Ltd',
    email: 'contact@cloudserve.net',
    industry: 'Services',
    employees: '1-10',
    revenue: '$100K - $500K',
    submittedDate: 'Jan 24, 2026',
    status: 'completed',
    priority: 'low',
    completionScore: 100,
    qualityScore: 98,
  },
];

export function SubmissionsListPage({ onViewCortex, searchInputRef }: SubmissionsListPageProps) {
  // Use context for persistent state
  const {
    state,
    setSearchQuery,
    setActiveFilter,
    toggleSubmission,
    selectAllSubmissions,
    clearSelections,
    setCortexState,
  } = useDashboard();

  // Restore scroll position
  useScrollRestoration('submissions-list');

  // Get state from context
  const searchQuery = state.searchQuery;
  const selectedFilter = state.activeFilter;
  const selectedSubmissions = state.selectedSubmissions;

  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>(sampleSubmissions);

  const filterOptions = [
    'All Submissions',
    'New Only',
    'In Review',
    'Completed',
    'High Priority',
  ];

  // Filter submissions based on search and filter
  const filteredSubmissions = submissions.filter((sub) => {
    const matchesSearch =
      sub.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.industry.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter =
      selectedFilter === 'All Submissions' ||
      (selectedFilter === 'New Only' && sub.status === 'new') ||
      (selectedFilter === 'In Review' && sub.status === 'in-review') ||
      (selectedFilter === 'Completed' && sub.status === 'completed') ||
      (selectedFilter === 'High Priority' && sub.priority === 'high');

    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new':
        return { bg: 'rgba(139, 92, 246, 0.1)', border: '#8B5CF6', text: '#8B5CF6' };
      case 'in-review':
        return { bg: 'rgba(251, 146, 60, 0.1)', border: '#FB923C', text: '#FB923C' };
      case 'completed':
        return { bg: 'rgba(6, 215, 246, 0.1)', border: '#06D7F6', text: '#06D7F6' };
      default:
        return { bg: 'rgba(112, 112, 124, 0.1)', border: '#70707C', text: '#70707C' };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return { bg: 'rgba(253, 68, 56, 0.1)', border: '#FD4438', text: '#FD4438' };
      case 'medium':
        return { bg: 'rgba(251, 146, 60, 0.1)', border: '#FB923C', text: '#FB923C' };
      case 'low':
        return { bg: 'rgba(6, 215, 246, 0.1)', border: '#06D7F6', text: '#06D7F6' };
      default:
        return { bg: 'rgba(112, 112, 124, 0.1)', border: '#70707C', text: '#70707C' };
    }
  };

  // Action handlers
  const handleApprove = (id: string) => {
    setSubmissions(
      submissions.map((s) =>
        s.id === id ? { ...s, status: 'approved' as const } : s
      )
    );
  };

  const handleEdit = (id: string) => {
    // Navigate to CORTEX detail view for this submission
    setCortexState({ view: 'detail', leadId: id, selectedLeadId: id });
    onViewCortex();
  };

  const handleSend = (id: string) => {
    setSubmissions(
      submissions.map((s) =>
        s.id === id ? { ...s, status: 'completed' as const } : s
      )
    );
  };

  const handleAutoSend = (id: string) => {
    setSubmissions(
      submissions.map((s) =>
        s.id === id ? { ...s, status: 'completed' as const } : s
      )
    );
  };

  const handleApproveAll = () => {
    setSubmissions(
      submissions.map((s) =>
        selectedSubmissions.includes(s.id) ? { ...s, status: 'approved' as const } : s
      )
    );
    clearSelections();
  };

  const handleSendAll = () => {
    setSubmissions(
      submissions.map((s) =>
        selectedSubmissions.includes(s.id) ? { ...s, status: 'completed' as const } : s
      )
    );
    clearSelections();
  };

  return (
    <div className="p-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Diagnostic Submissions
            </h1>
            <p className="text-gray-400">
              Manage and review all diagnostic submissions
            </p>
          </div>

          {/* Search and Filter */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                size={20}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search submissions..."
                className="w-80 h-12 pl-12 pr-4 bg-black/40 border border-white/10 rounded-lg text-white placeholder:text-gray-400 focus:border-[#8B5CF6] focus:outline-none transition-colors"
                ref={searchInputRef}
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className="h-12 px-5 bg-black/40 border border-white/10 rounded-lg text-white flex items-center gap-2 hover:border-[#8B5CF6] transition-colors"
              >
                <Filter size={18} />
                {selectedFilter}
                <ChevronDown size={16} />
              </button>

              {showFilterMenu && (
                <div className="absolute top-14 right-0 w-56 bg-black/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl p-2 z-50">
                  {filterOptions.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        setActiveFilter(option);
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                        selectedFilter === option
                          ? 'bg-[#8B5CF6]/20 text-[#8B5CF6]'
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Submissions"
            value={submissions.length}
            color="#8B5CF6"
          />
          <StatCard
            label="New"
            value={submissions.filter((s) => s.status === 'new').length}
            color="#3B82F6"
          />
          <StatCard
            label="In Review"
            value={submissions.filter((s) => s.status === 'in-review').length}
            color="#FB923C"
          />
          <StatCard
            label="Completed"
            value={submissions.filter((s) => s.status === 'completed').length}
            color="#06D7F6"
          />
        </div>
      </div>

      {/* Batch Actions */}
      {selectedSubmissions.length > 0 && (
        <BatchActions
          selectedCount={selectedSubmissions.length}
          onApproveAll={handleApproveAll}
          onSendAll={handleSendAll}
          onClearSelection={clearSelections}
        />
      )}

      {/* Submissions List */}
      <div className="space-y-4">
        {filteredSubmissions.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No submissions found matching your criteria
          </div>
        ) : (
          filteredSubmissions.map((submission) => {
            const statusStyle = getStatusColor(submission.status);
            const priorityStyle = getPriorityColor(submission.priority);

            return (
              <motion.div
                key={submission.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-black/40 border border-white/10 rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-all"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="px-3 py-1 rounded-full text-xs font-bold"
                      style={{
                        background: priorityStyle.bg,
                        border: `1px solid ${priorityStyle.border}`,
                        color: priorityStyle.text,
                      }}
                    >
                      {submission.priority.toUpperCase()}
                    </div>
                    <div
                      className="px-3 py-1 rounded-full text-xs font-bold"
                      style={{
                        background: statusStyle.bg,
                        border: `1px solid ${statusStyle.border}`,
                        color: statusStyle.text,
                      }}
                    >
                      {submission.status.replace('-', ' ').toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Calendar size={16} />
                    {submission.submittedDate}
                  </div>
                </div>

                {/* Company Info */}
                <h3 className="text-2xl font-bold text-white mb-2">
                  {submission.company}
                </h3>

                <div className="flex items-center gap-6 mb-4 text-sm text-gray-400">
                  <div className="flex items-center gap-2">
                    <Mail size={16} />
                    {submission.email}
                  </div>
                  <div className="flex items-center gap-2">
                    <Building2 size={16} />
                    {submission.industry}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-6 pt-4 border-t border-white/10 mb-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Employees</p>
                    <p className="text-sm font-bold text-white">{submission.employees}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Revenue</p>
                    <p className="text-sm font-bold text-white">{submission.revenue}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Completion</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#8B5CF6]">
                        {submission.completionScore}%
                      </p>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-full"
                          style={{ width: `${submission.completionScore}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Action</p>
                    <button
                      onClick={onViewCortex}
                      className="text-sm font-bold text-[#06D7F6] hover:text-[#3B82F6] transition-colors"
                    >
                      View Details →
                    </button>
                  </div>
                </div>

                {/* Quick Actions */}
                <QuickActions
                  submissionId={submission.id}
                  qualityScore={submission.qualityScore || 85}
                  status={submission.status}
                  onApprove={() => handleApprove(submission.id)}
                  onEdit={() => handleEdit(submission.id)}
                  onSend={() => handleSend(submission.id)}
                  onAutoSend={() => handleAutoSend(submission.id)}
                />
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-4">
      <p className="text-sm text-gray-400 mb-2">{label}</p>
      <p className="text-3xl font-bold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}