/**
 * 🛡️ REVIEWER COMMAND CENTER
 * 
 * Live quality monitoring dashboard that shows:
 * - Real-time submission feed with auto-approval scores
 * - Quality metrics across all checkpoints
 * - Auto-routing status (approve/review/revision)
 * - Team performance analytics
 * - Live alerts and flags
 * 
 * This is the control room for quality enforcement.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Clock,
  TrendingUp,
  TrendingDown,
  Zap,
  Filter,
  Search,
  Download,
  Bell,
  Activity,
  BarChart3,
  Users,
  Target,
  FileText,
  Phone,
  DollarSign,
  Sparkles,
  Flag,
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { FEATURES } from '@/config/features';

interface QualityScore {
  overall: number;
  breakdown: {
    intakeQuality: number;
    diagnosisAccuracy: number;
    scoringSanity: number;
    recommendationControl: number;
    roiValidation: number;
    reportQuality: number;
    callReadiness: number;
    proposalCheck: number;
  };
}

interface Submission {
  id: string;
  companyName: string;
  industry: string;
  submittedAt: string;
  qualityScore: QualityScore;
  status: 'auto-approved' | 'needs-review' | 'needs-revision' | 'not-a-fit';
  flags: string[];
  reviewer?: string;
  timeToReview?: number;
  liveInsights: number;
  patternsDetected: string[];
  readinessScore: number;
}

export function ReviewerDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>(generateMockSubmissions());
  const [filter, setFilter] = useState<'all' | 'auto-approved' | 'needs-review' | 'needs-revision'>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Simulate live submissions
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate new submission every 30 seconds
      if (Math.random() > 0.7) {
        const newSubmission = generateRandomSubmission();
        setSubmissions(prev => [newSubmission, ...prev]);
        
        // Show notification for submissions needing review
        if (newSubmission.status === 'needs-review') {
          showNotification(newSubmission);
        }
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const filteredSubmissions = submissions.filter(s => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (searchQuery && !s.companyName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = calculateStats(submissions);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-[1800px] mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <Shield className="size-8 text-[#8B5CF6]" />
                Quality Command Center
              </h1>
              <p className="text-white/60">
                Live monitoring of diagnostic submissions • Auto-quality enforcement
              </p>
            </div>

            {/* Live Status */}
            <div className="flex items-center gap-4">
              <LiveStatusIndicator submissions={submissions} />
              <button className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-2">
                <Download className="size-4" />
                Export Report
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-5 gap-4">
            <StatCard
              label="Today's Submissions"
              value={stats.todayCount}
              change={stats.todayChange}
              icon={<FileText className="size-5 text-[#8B5CF6]" />}
            />
            <StatCard
              label="Auto-Approved"
              value={`${stats.autoApprovedPercent}%`}
              subtext={`${stats.autoApprovedCount} submissions`}
              icon={<CheckCircle2 className="size-5 text-[#06D7F6]" />}
              trend="up"
            />
            <StatCard
              label="Avg Quality Score"
              value={stats.avgQualityScore}
              subtext="Out of 100"
              icon={<Target className="size-5 text-[#8B5CF6]" />}
              trend={stats.qualityTrend}
            />
            <StatCard
              label="Avg Review Time"
              value={stats.avgReviewTime}
              subtext="Was 20 min"
              icon={<Clock className="size-5 text-[#06D7F6]" />}
              trend="down"
            />
            <StatCard
              label="Needing Review"
              value={stats.needsReviewCount}
              urgent={stats.needsReviewCount > 5}
              icon={<AlertTriangle className="size-5 text-[#FB923C]" />}
            />
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Left: Submission Feed */}
          <div className="col-span-8 space-y-4">
            {/* Filters & Search */}
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-white/40" />
                <input
                  type="text"
                  placeholder="Search by company name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6]/50"
                />
              </div>

              <div className="flex gap-2">
                <FilterButton
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                  label="All"
                  count={submissions.length}
                />
                <FilterButton
                  active={filter === 'auto-approved'}
                  onClick={() => setFilter('auto-approved')}
                  label="Auto-Approved"
                  count={submissions.filter(s => s.status === 'auto-approved').length}
                  color="cyan"
                />
                <FilterButton
                  active={filter === 'needs-review'}
                  onClick={() => setFilter('needs-review')}
                  label="Needs Review"
                  count={submissions.filter(s => s.status === 'needs-review').length}
                  color="orange"
                />
                <FilterButton
                  active={filter === 'needs-revision'}
                  onClick={() => setFilter('needs-revision')}
                  label="Needs Revision"
                  count={submissions.filter(s => s.status === 'needs-revision').length}
                  color="red"
                />
              </div>
            </div>

            {/* Submission Feed */}
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filteredSubmissions.map((submission, idx) => (
                  <motion.div
                    key={submission.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <SubmissionCard
                      submission={submission}
                      onClick={() => setSelectedSubmission(submission)}
                      isSelected={selectedSubmission?.id === submission.id}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {filteredSubmissions.length === 0 && (
                <div className="text-center py-16 text-white/40">
                  <Filter className="size-12 mx-auto mb-4 opacity-30" />
                  <p>No submissions match your filters</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Detail Panel or Analytics */}
          <div className="col-span-4 space-y-4">
            {selectedSubmission ? (
              <SubmissionDetailPanel
                submission={selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
              />
            ) : (
              <AnalyticsPanel stats={stats} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SUBMISSION CARD
// ============================================================================

function SubmissionCard({
  submission,
  onClick,
  isSelected
}: {
  submission: Submission;
  onClick: () => void;
  isSelected: boolean;
}) {
  const statusConfig = {
    'auto-approved': {
      label: 'Auto-Approved',
      icon: <CheckCircle2 className="size-4" />,
      color: 'text-[#06D7F6] bg-[#06D7F6]/20 border-[#06D7F6]/30'
    },
    'needs-review': {
      label: 'Needs Review',
      icon: <Eye className="size-4" />,
      color: 'text-[#FB923C] bg-[#FB923C]/20 border-[#FB923C]/30'
    },
    'needs-revision': {
      label: 'Needs Revision',
      icon: <AlertTriangle className="size-4" />,
      color: 'text-[#FD4438] bg-[#FD4438]/20 border-[#FD4438]/30'
    },
    'not-a-fit': {
      label: 'Not a Fit',
      icon: <XCircle className="size-4" />,
      color: 'text-white/40 bg-white/5 border-white/10'
    }
  };

  const status = statusConfig[submission.status];

  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`w-full bg-black/40 backdrop-blur-xl border rounded-xl p-5 text-left transition-all ${
        isSelected ? 'border-[#8B5CF6] bg-[#8B5CF6]/10' : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-bold text-lg">{submission.companyName}</h3>
            {submission.flags.length > 0 && (
              <span className="size-5 rounded-full bg-[#FB923C]/20 text-[#FB923C] flex items-center justify-center text-xs font-bold">
                {submission.flags.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-white/60">
            <span>{submission.industry}</span>
            <span>•</span>
            <span>{formatTime(submission.submittedAt)}</span>
          </div>
        </div>

        <div className={`px-3 py-1.5 rounded-full border flex items-center gap-2 text-sm font-semibold ${status.color}`}>
          {status.icon}
          {status.label}
        </div>
      </div>

      {/* Quality Score Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-white/70">Quality Score</span>
          <span className="text-sm font-bold" style={{ color: getScoreColor(submission.qualityScore.overall) }}>
            {submission.qualityScore.overall}/100
          </span>
        </div>
        <div className="h-2 bg-black/40 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${submission.qualityScore.overall}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{
              background: `linear-gradient(90deg, ${getScoreColor(submission.qualityScore.overall)}, ${getScoreColor(submission.qualityScore.overall)}80)`
            }}
          />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <QuickStat
          icon={<Sparkles className="size-4 text-[#8B5CF6]" />}
          label="Live Insights"
          value={submission.liveInsights}
        />
        <QuickStat
          icon={<Target className="size-4 text-[#06D7F6]" />}
          label="Readiness"
          value={`${submission.readinessScore}%`}
        />
        <QuickStat
          icon={<Activity className="size-4 text-[#FB923C]" />}
          label="Patterns"
          value={submission.patternsDetected.length}
        />
      </div>

      {/* Flags */}
      {submission.flags.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-start gap-2">
            <Flag className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/70">
              {submission.flags.slice(0, 2).join(' • ')}
              {submission.flags.length > 2 && ` +${submission.flags.length - 2} more`}
            </div>
          </div>
        </div>
      )}
    </motion.button>
  );
}

// ============================================================================
// SUBMISSION DETAIL PANEL
// ============================================================================

function SubmissionDetailPanel({
  submission,
  onClose
}: {
  submission: Submission;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-32 space-y-4">
      {/* Header */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold mb-2">{submission.companyName}</h3>
            <div className="text-sm text-white/60">
              {submission.industry} • {formatTime(submission.submittedAt)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            ×
          </button>
        </div>

        {/* Overall Score */}
        <div className="text-center py-6 border-y border-white/10">
          <div className="text-sm text-white/60 mb-2">Quality Score</div>
          <div className="text-5xl font-bold mb-2" style={{ color: getScoreColor(submission.qualityScore.overall) }}>
            {submission.qualityScore.overall}
          </div>
          <div className="text-sm text-white/50">Out of 100</div>
        </div>
      </div>

      {/* Quality Breakdown */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="size-5 text-[#8B5CF6]" />
          Quality Breakdown
        </h4>
        <div className="space-y-3">
          <CheckpointScore label="A. Intake Quality" score={submission.qualityScore.breakdown.intakeQuality} />
          <CheckpointScore label="B. Diagnosis" score={submission.qualityScore.breakdown.diagnosisAccuracy} />
          <CheckpointScore label="C. Scoring" score={submission.qualityScore.breakdown.scoringSanity} />
          <CheckpointScore label="D. Recommendation" score={submission.qualityScore.breakdown.recommendationControl} />
          <CheckpointScore label="E. ROI" score={submission.qualityScore.breakdown.roiValidation} />
          <CheckpointScore label="F. Report" score={submission.qualityScore.breakdown.reportQuality} />
          <CheckpointScore label="G. Call Prep" score={submission.qualityScore.breakdown.callReadiness} />
          <CheckpointScore label="H. Proposal" score={submission.qualityScore.breakdown.proposalCheck} />
        </div>
      </div>

      {/* Patterns Detected */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="size-5 text-[#06D7F6]" />
          Patterns Detected
        </h4>
        <div className="flex flex-wrap gap-2">
          {submission.patternsDetected.map((pattern, idx) => (
            <span
              key={idx}
              className="px-3 py-1.5 rounded-full bg-gradient-to-r from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 text-sm"
            >
              {pattern}
            </span>
          ))}
        </div>
      </div>

      {/* Flags */}
      {submission.flags.length > 0 && (
        <div className="bg-gradient-to-br from-[#FB923C]/20 to-[#FD4438]/20 border border-[#FB923C]/30 rounded-xl p-6">
          <h4 className="font-semibold mb-4 flex items-center gap-2">
            <Flag className="size-5 text-[#FB923C]" />
            Attention Required
          </h4>
          <div className="space-y-2">
            {submission.flags.map((flag, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-white/80">
                <AlertCircle className="size-4 text-[#FB923C] flex-shrink-0 mt-0.5" />
                {flag}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-4 py-3 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white font-semibold flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="size-4" />
          Approve
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold flex items-center justify-center gap-2"
        >
          <Eye className="size-4" />
          Full Review
        </motion.button>
      </div>
    </div>
  );
}

// ============================================================================
// ANALYTICS PANEL
// ============================================================================

function AnalyticsPanel({ stats }: { stats: any }) {
  return (
    <div className="sticky top-32 space-y-4">
      {/* Quality Trends */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="size-5 text-[#06D7F6]" />
          Quality Trends
        </h4>
        <div className="space-y-4">
          <TrendMetric
            label="Auto-Approval Rate"
            value={`${stats.autoApprovedPercent}%`}
            change="+12%"
            positive
          />
          <TrendMetric
            label="Avg Quality Score"
            value={stats.avgQualityScore}
            change="+8 pts"
            positive
          />
          <TrendMetric
            label="Review Time"
            value={stats.avgReviewTime}
            change="-15 min"
            positive
          />
          <TrendMetric
            label="Clarification Rate"
            value="8%"
            change="-32%"
            positive
          />
        </div>
      </div>

      {/* Top Patterns */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <Activity className="size-5 text-[#8B5CF6]" />
          Top Patterns (24h)
        </h4>
        <div className="space-y-3">
          <PatternBar label="Manual-Heavy" count={34} total={50} color="#FB923C" />
          <PatternBar label="Scale Stress" count={28} total={50} color="#8B5CF6" />
          <PatternBar label="Tool Chaos" count={21} total={50} color="#06D7F6" />
          <PatternBar label="Decision Bottleneck" count={18} total={50} color="#3B82F6" />
        </div>
      </div>

      {/* Team Performance */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <Users className="size-5 text-[#06D7F6]" />
          Team Performance
        </h4>
        <div className="space-y-3">
          <TeamMember
            name="Sarah Chen"
            reviewed={23}
            avgTime="2.1 min"
            accuracy={96}
          />
          <TeamMember
            name="Michael Ross"
            reviewed={18}
            avgTime="3.4 min"
            accuracy={94}
          />
          <TeamMember
            name="AI Auto-Approve"
            reviewed={142}
            avgTime="0 min"
            accuracy={98}
            isAI
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

function StatCard({
  label,
  value,
  subtext,
  change,
  icon,
  trend,
  urgent
}: {
  label: string;
  value: string | number;
  subtext?: string;
  change?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down';
  urgent?: boolean;
}) {
  return (
    <div className={`bg-black/40 backdrop-blur-xl border rounded-xl p-4 ${urgent ? 'border-[#FB923C]/50 animate-pulse' : 'border-white/10'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-white/60">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      {subtext && <div className="text-xs text-white/50">{subtext}</div>}
      {change && (
        <div className={`text-xs mt-2 flex items-center gap-1 ${trend === 'up' ? 'text-[#06D7F6]' : trend === 'down' ? 'text-[#FD4438]' : 'text-white/50'}`}>
          {trend === 'up' ? <TrendingUp className="size-3" /> : trend === 'down' ? <TrendingDown className="size-3" /> : null}
          {change} vs yesterday
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
  color = 'purple'
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: 'purple' | 'cyan' | 'orange' | 'red';
}) {
  const colors = {
    purple: 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#8B5CF6]',
    cyan: 'border-[#06D7F6] bg-[#06D7F6]/20 text-[#06D7F6]',
    orange: 'border-[#FB923C] bg-[#FB923C]/20 text-[#FB923C]',
    red: 'border-[#FD4438] bg-[#FD4438]/20 text-[#FD4438]'
  };

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl border font-semibold transition-all ${
        active ? colors[color] : 'border-white/10 bg-black/20 text-white/60 hover:bg-white/5'
      }`}
    >
      {label} <span className="ml-1.5 opacity-70">({count})</span>
    </button>
  );
}

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <div className="text-xs text-white/50">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function CheckpointScore({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-white/70">{label}</span>
        <span className="text-sm font-semibold" style={{ color: getScoreColor(score) }}>
          {score}/10
        </span>
      </div>
      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${(score / 10) * 100}%`,
            background: getScoreColor(score)
          }}
        />
      </div>
    </div>
  );
}

function TrendMetric({
  label,
  value,
  change,
  positive
}: {
  label: string;
  value: string;
  change: string;
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/70">{label}</span>
      <div className="text-right">
        <div className="text-sm font-semibold">{value}</div>
        <div className={`text-xs ${positive ? 'text-[#06D7F6]' : 'text-[#FD4438]'}`}>
          {change}
        </div>
      </div>
    </div>
  );
}

function PatternBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-white/70">{label}</span>
        <span className="text-sm font-semibold">{count}</span>
      </div>
      <div className="h-2 bg-black/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${(count / total) * 100}%`,
            backgroundColor: color
          }}
        />
      </div>
    </div>
  );
}

function TeamMember({
  name,
  reviewed,
  avgTime,
  accuracy,
  isAI
}: {
  name: string;
  reviewed: number;
  avgTime: string;
  accuracy: number;
  isAI?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
      <div className="flex items-center gap-3">
        <div className={`size-10 rounded-full flex items-center justify-center ${isAI ? 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6]' : 'bg-white/10'}`}>
          {isAI ? <Zap className="size-5 text-white" /> : <Users className="size-5 text-white/60" />}
        </div>
        <div>
          <div className="font-semibold text-sm">{name}</div>
          <div className="text-xs text-white/50">{reviewed} reviewed</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold">{avgTime}</div>
        <div className="text-xs text-[#06D7F6]">{accuracy}% accurate</div>
      </div>
    </div>
  );
}

function LiveStatusIndicator({ submissions }: { submissions: Submission[] }) {
  const needsReview = submissions.filter(s => s.status === 'needs-review').length;
  
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-black/40 border border-white/10">
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="size-2 rounded-full bg-[#06D7F6]"
      />
      <div>
        <div className="text-xs text-white/60">Live Status</div>
        <div className="text-sm font-semibold">
          {needsReview > 0 ? `${needsReview} awaiting review` : 'All clear'}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getScoreColor(score: number): string {
  if (score >= 90) return '#06D7F6';
  if (score >= 75) return '#8B5CF6';
  if (score >= 60) return '#FB923C';
  return '#FD4438';
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function calculateStats(submissions: Submission[]) {
  const today = submissions.filter(s => {
    const date = new Date(s.submittedAt);
    const now = new Date();
    return date.toDateString() === now.toDateString();
  });

  const autoApproved = submissions.filter(s => s.status === 'auto-approved');
  const needsReview = submissions.filter(s => s.status === 'needs-review');
  
  const avgQuality = Math.round(
    submissions.reduce((sum, s) => sum + s.qualityScore.overall, 0) / submissions.length
  );

  return {
    todayCount: today.length,
    todayChange: '+23%',
    autoApprovedPercent: Math.round((autoApproved.length / submissions.length) * 100),
    autoApprovedCount: autoApproved.length,
    avgQualityScore: avgQuality,
    qualityTrend: 'up' as const,
    avgReviewTime: '2 min',
    needsReviewCount: needsReview.length
  };
}

function showNotification(submission: Submission) {
  // In production: Show browser notification
  console.log(`New submission needing review: ${submission.companyName}`);
}

// ============================================================================
// MOCK DATA
// ============================================================================

function generateMockSubmissions(): Submission[] {
  const companies = [
    { name: 'TechFlow Solutions', industry: 'SaaS' },
    { name: 'Green Valley Logistics', industry: 'Logistics' },
    { name: 'Premier Healthcare', industry: 'Healthcare' },
    { name: 'Summit Financial', industry: 'Finance' },
    { name: 'Bright Minds Education', industry: 'Education' },
    { name: 'Urban Retail Co', industry: 'Retail' },
    { name: 'Velocity Manufacturing', industry: 'Manufacturing' },
    { name: 'Nexus Consulting', industry: 'Consulting' }
  ];

  return companies.map((company, idx) => generateRandomSubmission(company.name, company.industry, idx));
}

function generateRandomSubmission(
  companyName?: string,
  industry?: string,
  idx?: number
): Submission {
  const score = Math.floor(Math.random() * 30) + 70; // 70-100
  
  let status: Submission['status'];
  if (score >= 90) status = 'auto-approved';
  else if (score >= 75) status = 'needs-review';
  else status = 'needs-revision';

  const patterns = ['Manual-Heavy', 'Scale Stress', 'Tool Chaos', 'Decision Bottleneck'];
  const selectedPatterns = patterns.slice(0, Math.floor(Math.random() * 3) + 1);

  const flags = score < 80 ? [
    'ROI estimates slightly aggressive',
    'Cross-validation needed on Problem #2',
    'Readiness score may be inflated'
  ].slice(0, Math.floor(Math.random() * 2) + 1) : [];

  return {
    id: `sub_${Date.now()}_${Math.random()}`,
    companyName: companyName || `Company ${Math.floor(Math.random() * 1000)}`,
    industry: industry || ['SaaS', 'Logistics', 'Healthcare', 'Finance'][Math.floor(Math.random() * 4)],
    submittedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    qualityScore: {
      overall: score,
      breakdown: {
        intakeQuality: Math.floor(Math.random() * 3) + 8,
        diagnosisAccuracy: Math.floor(Math.random() * 3) + 7,
        scoringSanity: Math.floor(Math.random() * 3) + 8,
        recommendationControl: Math.floor(Math.random() * 3) + 9,
        roiValidation: Math.floor(Math.random() * 3) + 7,
        reportQuality: Math.floor(Math.random() * 3) + 8,
        callReadiness: Math.floor(Math.random() * 3) + 9,
        proposalCheck: Math.floor(Math.random() * 3) + 8
      }
    },
    status,
    flags,
    liveInsights: Math.floor(Math.random() * 6) + 3,
    patternsDetected: selectedPatterns,
    readinessScore: Math.floor(Math.random() * 40) + 50
  };
}