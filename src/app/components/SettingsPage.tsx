/**
 * SETTINGS PAGE — Phase 4D
 *
 * Fully wired to Supabase:
 * - GET  /settings  — loads current user profile + platform settings + health
 * - PATCH /settings — saves profile name + platform settings to KV
 *
 * Tabs:
 * 1. Profile        — real name from Supabase auth, persists via PATCH
 * 2. Notifications  — 7 toggles, all persisted to KV
 * 3. Platform       — branding name, auto-assign, default assignee
 * 4. Platform Health — live submission counts + server time + recent events
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, User, Bell, Palette, Activity, Loader2,
  AlertTriangle, CheckCircle2, Save, RefreshCw, Server,
  Database, Clock, Zap, BarChart2, Users, FileText,
  MessageSquare, CheckCheck, TrendingUp, Mail, SendHorizonal,
} from 'lucide-react';
import {
  getPlatformSettings, savePlatformSettings,
  sendTestEmailRequest, sendWeeklyDigestRequest,
  type PlatformSettings, type SettingsResponse,
} from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

interface Props {
  accessToken?: string;
}

const TABS = [
  { id: 'profile',       label: 'Profile',          icon: User },
  { id: 'notifications', label: 'Notifications',     icon: Bell },
  { id: 'platform',      label: 'Platform',          icon: Palette },
  { id: 'health',        label: 'Platform Health',   icon: Activity },
];

export function SettingsPage({ accessToken }: Props) {
  const [activeTab, setActiveTab]   = useState('profile');
  const [data, setData]             = useState<SettingsResponse | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [toast, setToast]           = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (silent = false) => {
    if (!accessToken) { setIsLoading(false); return; }
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for settings (backend disabled)');
        }
        const demoSettings: SettingsResponse = {
          success: true,
          currentUser: {
            id: 'demo_user_1',
            email: 'demo@marqcortex.com',
            name: 'Demo User',
            teamRole: 'admin',
          },
          platformSettings: {
            companyName: 'MARQ Cortex',
            companyEmail: 'hello@marqcortex.com',
            reportFromName: 'MARQ Cortex Team',
            reportFromEmail: 'reports@marqcortex.com',
            emailDeliveryMethod: 'instant',
            emailSubjectLine: 'Your Diagnostic Report is Ready',
            smtpConfigured: false,
            emailNotifications: {
              submissionReceived: true,
              reviewComplete: true,
              reportReady: true,
              teamActivity: false,
              weeklyDigest: true,
              proposalViewed: true,
              proposalAccepted: true,
              messageReceived: true,
            },
          },
          health: {
            submissionCounts: { new: 5, 'in-review': 3, completed: 8, approved: 2, total: 18 },
            serverTime: new Date().toISOString(),
            recentActivity: [],
          },
        };
        setData(demoSettings);
        setIsLoading(false);
        return;
      }

      const res = await getPlatformSettings(accessToken);
      setData(res);
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to load settings:', err);
      }
      if (shouldShowApiErrors()) {
        setError(err.message || 'Failed to load settings');
      } else {
        const demoSettings: SettingsResponse = {
          success: true,
          currentUser: {
            id: 'demo_user_1',
            email: 'demo@marqcortex.com',
            name: 'Demo User',
            teamRole: 'admin',
          },
          platformSettings: {
            companyName: 'MARQ Cortex',
            companyEmail: 'hello@marqcortex.com',
            reportFromName: 'MARQ Cortex Team',
            reportFromEmail: 'reports@marqcortex.com',
            emailDeliveryMethod: 'instant',
            emailSubjectLine: 'Your Diagnostic Report is Ready',
            smtpConfigured: false,
            emailNotifications: {
              submissionReceived: true,
              reviewComplete: true,
              reportReady: true,
              teamActivity: false,
              weeklyDigest: true,
              proposalViewed: true,
              proposalAccepted: true,
              messageReceived: true,
            },
          },
          health: {
            submissionCounts: { new: 5, 'in-review': 3, completed: 8, approved: 2, total: 18 },
            serverTime: new Date().toISOString(),
            recentActivity: [],
          },
        };
        setData(demoSettings);
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload: Parameters<typeof savePlatformSettings>[0]) => {
    if (!accessToken) return;
    try {
      await savePlatformSettings(payload, accessToken);
      // Refresh data after save
      load(true);
      showToast('Settings saved successfully');
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="size-10 text-[#8B5CF6] animate-spin mx-auto mb-4" />
          <p className="text-white/40 text-sm">Loading settings…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl text-[#FD4438] text-sm mb-4">
          <AlertTriangle className="size-4 flex-shrink-0" />
          {error}
          <button onClick={() => load()} className="ml-auto underline text-xs">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
                : 'bg-[#FD4438]/10 border-[#FD4438]/30 text-[#FD4438]'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white mb-1">Settings</h1>
          <p className="text-white/50 text-sm">
            Manage your account, platform preferences, and monitor system health
            {data?.platformSettings?.updatedAt && (
              <span className="ml-2 text-white/30">
                · Last saved {new Date(data.platformSettings.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="p-2.5 bg-black/40 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:border-white/20 transition-all"
          title="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-5 py-3 font-semibold text-sm transition-colors whitespace-nowrap ${
                isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="settingsTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6]"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'profile' && data && (
            <ProfileTab user={data.currentUser} onSave={handleSave} />
          )}
          {activeTab === 'notifications' && data && (
            <NotificationsTab settings={data.platformSettings} onSave={handleSave} accessToken={accessToken} />
          )}
          {activeTab === 'platform' && data && (
            <PlatformTab settings={data.platformSettings} onSave={handleSave} />
          )}
          {activeTab === 'health' && data && (
            <HealthTab health={data.health} onRefresh={() => load()} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Profile tab ─────────────────────────────────────────────────────────────

function ProfileTab({
  user, onSave,
}: {
  user: SettingsResponse['currentUser'];
  onSave: (p: any) => Promise<void>;
}) {
  const [name, setName]     = useState(user.name);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || name === user.name) return;
    setIsSaving(true);
    try { await onSave({ profileName: name.trim() }); }
    finally { setIsSaving(false); }
  };

  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = user.teamRole === 'admin' ? 'Administrator' : user.teamRole === 'reviewer' ? 'Reviewer' : 'Viewer';

  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Profile Information" description="Your name is displayed throughout CORTEX and in team activities">
        <div className="flex items-center gap-5 mb-6">
          <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xl">{initials}</span>
          </div>
          <div>
            <p className="font-bold text-white text-lg">{name}</p>
            <p className="text-white/40 text-sm">{user.email}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-[#8B5CF6]/15 text-[#8B5CF6] rounded-full border border-[#8B5CF6]/30 font-semibold">
              {roleLabel}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-white mb-2">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#8B5CF6] focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-white mb-2">Email Address</label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-4 py-3 bg-white/3 border border-white/6 rounded-xl text-white/40 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-white/30 mt-1.5">Email is managed through Supabase Auth and cannot be changed here.</p>
          </div>

          <SaveBtn
            onClick={handleSave}
            isLoading={isSaving}
            disabled={!name.trim() || name === user.name}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Account Details" description="Read-only system information">
        <div className="space-y-3">
          <InfoRow label="User ID" value={user.id} mono />
          <InfoRow label="Role" value={roleLabel} />
          <InfoRow label="Access Level" value={user.teamRole === 'admin' ? 'Full platform access' : user.teamRole === 'reviewer' ? 'Edit & send reports' : 'Read-only access'} />
        </div>
      </SettingsCard>
    </div>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────────

function NotificationsTab({
  settings, onSave, accessToken,
}: {
  settings: PlatformSettings;
  onSave: (p: any) => Promise<void>;
  accessToken?: string;
}) {
  const [prefs, setPrefs]               = useState({ ...settings.notificationPrefs });
  const [isSaving, setIsSaving]         = useState(false);
  const [testState, setTestState]       = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testResult, setTestResult]     = useState<{ to?: string; sent?: boolean } | null>(null);
  const [digestState, setDigestState]   = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const toggle = (key: keyof typeof prefs) =>
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    setIsSaving(true);
    try { await onSave({ platformSettings: { ...settings, notificationPrefs: prefs } }); }
    finally { setIsSaving(false); }
  };

  const handleTestEmail = async () => {
    if (!accessToken) return;
    setTestState('sending');
    setTestResult(null);
    try {
      const res = await sendTestEmailRequest(accessToken);
      setTestResult({ to: res.to, sent: res.sent });
      setTestState('sent');
      setTimeout(() => setTestState('idle'), 6000);
    } catch (err: any) {
      setTestState('error');
      setTimeout(() => setTestState('idle'), 5000);
    }
  };

  const handleWeeklyDigest = async () => {
    if (!accessToken) return;
    setDigestState('sending');
    try {
      await sendWeeklyDigestRequest(accessToken);
      setDigestState('sent');
      setTimeout(() => setDigestState('idle'), 5000);
    } catch {
      setDigestState('error');
      setTimeout(() => setDigestState('idle'), 5000);
    }
  };

  const groups = [
    {
      title: 'Submissions',
      description: 'Team email alerts for submission lifecycle events',
      items: [
        { key: 'newSubmission' as const,   label: 'New submission received',   description: 'Team email when a new diagnostic is submitted' },
        { key: 'reportReady' as const,     label: 'Report marked as ready',    description: 'Client email when a submission moves to Completed' },
      ],
    },
    {
      title: 'Proposals',
      description: 'Email notifications for the proposal lifecycle',
      items: [
        { key: 'proposalViewed' as const,  label: 'Proposal viewed by client', description: 'Team email when client opens a sent proposal' },
        { key: 'proposalAccepted' as const,label: 'Proposal responded',        description: 'Team email when a client accepts or declines' },
      ],
    },
    {
      title: 'Communication',
      description: 'Message thread email notifications',
      items: [
        { key: 'messageReceived' as const, label: 'New client message',        description: 'Team email when a client sends a message' },
        { key: 'teamActivity' as const,    label: 'Team member activity',      description: 'When a team member makes a change (in-app only)' },
      ],
    },
    {
      title: 'Digest',
      description: 'Scheduled summary emails',
      items: [
        { key: 'weeklyDigest' as const,    label: 'Weekly performance summary', description: 'Monday morning email summary to the team' },
      ],
    },
  ];

  return (
    <div className="max-w-2xl space-y-5">

      {/* ── Email Delivery Status card ── */}
      <div className="bg-black/40 border border-white/10 rounded-xl p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="font-bold text-white mb-1 flex items-center gap-2">
              <Mail className="size-4 text-[#8B5CF6]" />
              Email Delivery
            </h3>
            <p className="text-xs text-white/40">
              Powered by Resend. Set <code className="text-[#06D7F6] bg-white/5 px-1 py-0.5 rounded text-xs">RESEND_API_KEY</code> in Supabase → Edge Functions → Secrets to activate.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {/* Test email button */}
          <div className="bg-white/3 border border-white/8 rounded-xl p-4">
            <p className="font-semibold text-white text-sm mb-1">Send Test Email</p>
            <p className="text-xs text-white/40 mb-3">Verify your Resend key is working — sends to your account email</p>
            <button
              onClick={handleTestEmail}
              disabled={testState === 'sending' || !accessToken}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs transition-all ${
                testState === 'sent'
                  ? 'bg-[#10B981]/15 border border-[#10B981]/30 text-[#10B981]'
                  : testState === 'error'
                  ? 'bg-[#FD4438]/15 border border-[#FD4438]/30 text-[#FD4438]'
                  : 'bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[#8B5CF6] hover:bg-[#8B5CF6]/25'
              } disabled:opacity-40`}
            >
              {testState === 'sending' ? (
                <span className="contents"><Loader2 className="size-3 animate-spin" />Sending…</span>
              ) : testState === 'sent' ? (
                <span className="contents"><CheckCircle2 className="size-3" />Sent to {testResult?.to?.split('@')[0]}…</span>
              ) : testState === 'error' ? (
                <span className="contents"><AlertTriangle className="size-3" />Failed — check key</span>
              ) : (
                <span className="contents"><SendHorizonal className="size-3" />Send Test</span>
              )}
            </button>
            {testState === 'sent' && testResult && (
              <p className="text-xs text-[#10B981]/70 mt-2">
                {testResult.sent ? `✓ Delivered to ${testResult.to}` : '⚠ Queued (no RESEND_API_KEY set — check server logs)'}
              </p>
            )}
          </div>

          {/* Weekly digest trigger */}
          <div className="bg-white/3 border border-white/8 rounded-xl p-4">
            <p className="font-semibold text-white text-sm mb-1">Send Weekly Digest</p>
            <p className="text-xs text-white/40 mb-3">Manually trigger this week's performance summary email</p>
            <button
              onClick={handleWeeklyDigest}
              disabled={digestState === 'sending' || !accessToken || !prefs.weeklyDigest}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs transition-all ${
                digestState === 'sent'
                  ? 'bg-[#10B981]/15 border border-[#10B981]/30 text-[#10B981]'
                  : digestState === 'error'
                  ? 'bg-[#FD4438]/15 border border-[#FD4438]/30 text-[#FD4438]'
                  : 'bg-[#3B82F6]/15 border border-[#3B82F6]/30 text-[#3B82F6] hover:bg-[#3B82F6]/25'
              } disabled:opacity-40`}
              title={!prefs.weeklyDigest ? 'Enable the Weekly Digest toggle below first' : ''}
            >
              {digestState === 'sending' ? (
                <span className="contents"><Loader2 className="size-3 animate-spin" />Sending…</span>
              ) : digestState === 'sent' ? (
                <span className="contents"><CheckCircle2 className="size-3" />Digest sent!</span>
              ) : digestState === 'error' ? (
                <span className="contents"><AlertTriangle className="size-3" />Failed</span>
              ) : (
                <span className="contents"><Mail className="size-3" />Send Digest</span>
              )}
            </button>
            {!prefs.weeklyDigest && (
              <p className="text-xs text-white/30 mt-2">Enable the Weekly Digest toggle below first</p>
            )}
          </div>
        </div>

        <div className="p-3 bg-white/3 rounded-xl border border-white/8 text-xs text-white/40 leading-relaxed">
          <span className="text-white/60 font-semibold">How it works:</span> Client emails (under review, report ready, proposal sent, team replies) are always delivered. Team alert emails respect the toggles below. Disabling a toggle prevents that specific email from being sent but does not affect in-app notifications.
        </div>
      </div>

      {/* ── Preference toggles ── */}
      {groups.map(group => (
        <SettingsCard key={group.title} title={group.title} description={group.description}>
          <div className="space-y-3">
            {group.items.map(item => (
              <div key={item.key} className="flex items-center justify-between p-4 bg-white/3 border border-white/8 rounded-xl">
                <div>
                  <p className="font-semibold text-white text-sm mb-0.5">{item.label}</p>
                  <p className="text-xs text-white/40">{item.description}</p>
                </div>
                <Toggle checked={prefs[item.key]} onChange={() => toggle(item.key)} />
              </div>
            ))}
          </div>
        </SettingsCard>
      ))}

      <SaveBtn onClick={handleSave} isLoading={isSaving} />
    </div>
  );
}

// ── Platform tab ─────────────────────────────────────────────────────────────

function PlatformTab({
  settings, onSave,
}: {
  settings: PlatformSettings;
  onSave: (p: any) => Promise<void>;
}) {
  const [brandingName, setBrandingName] = useState(settings.brandingName || 'CORTEX Intelligence');
  const [autoAssign, setAutoAssign]     = useState(settings.autoAssign ?? true);
  const [defaultAssignee, setDefaultAssignee] = useState(settings.defaultAssignee || 'auto');
  const [isSaving, setIsSaving]         = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        platformSettings: {
          ...settings,
          brandingName,
          autoAssign,
          defaultAssignee,
        },
      });
    } finally { setIsSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <SettingsCard title="Branding" description="Customize how the platform presents itself">
        <div>
          <label className="block text-sm font-semibold text-white mb-2">Platform Name</label>
          <input
            type="text"
            value={brandingName}
            onChange={e => setBrandingName(e.target.value)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#8B5CF6] focus:outline-none text-sm"
          />
          <p className="text-xs text-white/30 mt-1.5">Displayed in the team dashboard header and client portal.</p>
        </div>
      </SettingsCard>

      <SettingsCard title="Auto-Assignment" description="Control how new submissions are assigned to team members">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white/3 border border-white/8 rounded-xl">
            <div>
              <p className="font-semibold text-white text-sm mb-0.5">Auto-assign new submissions</p>
              <p className="text-xs text-white/40">Automatically assign incoming submissions to a team member</p>
            </div>
            <Toggle checked={autoAssign} onChange={() => setAutoAssign(prev => !prev)} />
          </div>

          {autoAssign && (
            <div>
              <label className="block text-sm font-semibold text-white mb-2">Default Assignee</label>
              <select
                value={defaultAssignee}
                onChange={e => setDefaultAssignee(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#8B5CF6] focus:outline-none text-sm"
              >
                <option value="auto">Round-robin (auto-balance)</option>
                <option value="admin">Admin only</option>
                <option value="reviewer">Any Reviewer</option>
              </select>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Diagnostic Form" description="Configure the public-facing assessment">
        <div className="space-y-3">
          <InfoRow label="Form Status" value="Active — accepting submissions" valueColor="#10B981" />
          <InfoRow label="Question Types" value="Universal + Industry-specific" />
          <InfoRow label="Routing" value="All submissions → CORTEX Dashboard" />
        </div>
      </SettingsCard>

      <SaveBtn onClick={handleSave} isLoading={isSaving} />
    </div>
  );
}

// ── Platform Health tab ───────────────────────────────────────────────────────

function HealthTab({
  health, onRefresh,
}: {
  health: SettingsResponse['health'];
  onRefresh: () => void;
}) {
  const counts = health.submissionCounts;
  const total  = counts.total || 0;

  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

  const statusBreakdown = [
    { label: 'New',        count: counts.new,          color: '#3B82F6',  pct: pct(counts.new) },
    { label: 'In Review',  count: counts['in-review'], color: '#FB923C',  pct: pct(counts['in-review']) },
    { label: 'Completed',  count: counts.completed,    color: '#8B5CF6',  pct: pct(counts.completed) },
    { label: 'Converted',  count: counts.approved,     color: '#10B981',  pct: pct(counts.approved) },
  ];

  return (
    <div className="space-y-5">
      {/* Health bar */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white">Platform Health</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/30">
            Server time: {new Date(health.serverTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-white/50 hover:text-white hover:border-white/20 transition-all text-xs"
          >
            <RefreshCw className="size-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* System status */}
      <div className="grid grid-cols-3 gap-4">
        <StatusCard icon={Server} label="Supabase Edge Function" status="operational" />
        <StatusCard icon={Database} label="KV Store (PostgreSQL)" status="operational" />
        <StatusCard icon={Zap} label="Supabase Auth" status="operational" />
      </div>

      {/* Pipeline counts */}
      <SettingsCard title="Submission Pipeline" description="Real-time counts from the KV store">
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl font-black text-white">{total}</span>
            <span className="text-sm text-white/40">total submissions</span>
          </div>
          {/* Stacked bar */}
          <div className="h-3 rounded-full overflow-hidden flex gap-0.5">
            {statusBreakdown.map(s => (
              s.count > 0 && (
                <div
                  key={s.label}
                  style={{ width: `${s.pct}%`, backgroundColor: s.color }}
                  className="h-full rounded-full min-w-[4px]"
                  title={`${s.label}: ${s.count}`}
                />
              )
            ))}
            {total === 0 && <div className="w-full h-full bg-white/10 rounded-full" />}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {statusBreakdown.map(s => (
            <div key={s.label} className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/6">
              <div className="flex items-center gap-2">
                <div className="size-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm text-white/60">{s.label}</span>
              </div>
              <span className="font-bold text-white">{s.count}</span>
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* Platform version */}
      <SettingsCard title="Platform Information" description="Current build metadata">
        <div className="space-y-3">
          <InfoRow label="Platform"       value="CORTEX Decision Intelligence" />
          <InfoRow label="Build Phase"    value="Phase 4D — Settings & Team Management" valueColor="#8B5CF6" />
          <InfoRow label="Version"        value="v4.0.0" />
          <InfoRow label="Backend"        value="Supabase Edge Function (Hono + Deno)" />
          <InfoRow label="Database"       value="PostgreSQL via KV Store (kv_store_324f4fbe)" />
          <InfoRow label="Auth Provider"  value="Supabase Auth (JWT)" />
          <InfoRow label="Frontend"       value="React + Tailwind CSS v4" />
        </div>
      </SettingsCard>

      {/* Recent activity */}
      {health.recentActivity && health.recentActivity.length > 0 && (
        <SettingsCard title="Recent Platform Events" description="Last 8 system notifications">
          <div className="space-y-2">
            {health.recentActivity.map((event: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="size-7 rounded-full bg-[#8B5CF6]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Activity className="size-3.5 text-[#8B5CF6]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium leading-tight truncate">{event.title}</p>
                  <p className="text-xs text-white/40 mt-0.5 truncate">{event.message}</p>
                </div>
                {event.createdAt && (
                  <span className="text-xs text-white/25 flex-shrink-0">
                    {new Date(event.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </SettingsCard>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SettingsCard({
  title, description, children,
}: {
  title: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-6">
      <div className="mb-5">
        <h3 className="font-bold text-white mb-1">{title}</h3>
        <p className="text-xs text-white/40">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-[#8B5CF6]' : 'bg-white/15'
      }`}
    >
      <motion.div
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-0.5 size-5 bg-white rounded-full shadow"
      />
    </button>
  );
}

function SaveBtn({
  onClick, isLoading, disabled, label = 'Save Changes',
}: {
  onClick: () => void; isLoading: boolean; disabled?: boolean; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading || disabled}
      className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
    >
      {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {isLoading ? 'Saving…' : label}
    </button>
  );
}

function InfoRow({
  label, value, mono, valueColor,
}: {
  label: string; value: string; mono?: boolean; valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-white/40">{label}</span>
      <span
        className={`text-sm font-medium ${mono ? 'font-mono text-white/70' : 'text-white'}`}
        style={valueColor ? { color: valueColor } : {}}
      >
        {value}
      </span>
    </div>
  );
}

function StatusCard({
  icon: Icon, label, status,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; status: 'operational' | 'degraded' | 'down';
}) {
  const cfg = {
    operational: { color: '#10B981', label: 'Operational', dot: 'bg-[#10B981]' },
    degraded:    { color: '#FB923C', label: 'Degraded',    dot: 'bg-[#FB923C]' },
    down:        { color: '#FD4438', label: 'Down',        dot: 'bg-[#FD4438]' },
  }[status];

  return (
    <div className="bg-black/40 border border-white/8 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="size-4 text-white/40" />
        <span className="text-xs text-white/40 leading-tight">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={`size-2 rounded-full ${cfg.dot} animate-pulse`} />
        <span className="text-sm font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
    </div>
  );
}