/**
 * TEAM MANAGEMENT — Phase 4D
 *
 * Fully wired to Supabase:
 * - GET  /team/members     — load real team from Supabase auth
 * - POST /team/invite      — create Supabase user + show temp credentials
 * - PATCH /team/members/:id — update role
 * - DELETE /team/members/:id — remove member
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users, UserPlus, Mail, Shield, Clock, CheckCircle2, X,
  Edit2, Trash2, Loader2, AlertTriangle, RefreshCw, Copy,
  ChevronDown, Check, Eye, Crown, Star,
} from 'lucide-react';
import {
  getTeamMembers, inviteTeamMember, updateTeamMember, removeTeamMember,
  getDemoTeamMembers, getDemoTeamFallback,
  type TeamMemberRecord,
} from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, canUseDemoFallback } from '@/config/runtime';

interface Props {
  accessToken?: string;
}

const ROLE_CONFIG = {
  admin:    { label: 'Admin',    color: 'text-[#8B5CF6] bg-[#8B5CF6]/10 border-[#8B5CF6]/30', icon: Crown },
  reviewer: { label: 'Reviewer', color: 'text-[#06D7F6] bg-[#06D7F6]/10 border-[#06D7F6]/30', icon: Star },
  viewer:   { label: 'Viewer',   color: 'text-white/60 bg-white/5 border-white/15',            icon: Eye },
};

const ROLE_PERMS: Record<string, string[]> = {
  admin:    ['All permissions — full platform access'],
  reviewer: ['View submissions', 'Manage CORTEX', 'Send proposals', 'Reply to messages', 'Add notes'],
  viewer:   ['View submissions', 'View reports (read-only)'],
};

export function TeamManagement({ accessToken }: Props) {
  const [members, setMembers]         = useState<TeamMemberRecord[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showInvite, setShowInvite]   = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    if (!accessToken) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      // Check feature flag before making API calls
      if (!isBackendEnabled()) {
        if (isVerboseLogging()) {
          console.log('📦 Using demo data for team members (backend disabled)');
        }
        // Demo team members
        const demoMembers: TeamMemberRecord[] = getDemoTeamMembers();
        setMembers(demoMembers);
        setIsLoading(false);
        return;
      }

      const res = await getTeamMembers(accessToken);
      setMembers(res.members);
    } catch (err: any) {
      if (isVerboseLogging()) {
        console.error('❌ Failed to load team members:', err);
      }
      if (canUseDemoFallback()) {
        // Demo mode only (defence-in-depth; unreachable in live mode because the
        // isBackendEnabled() guard above early-returns demo data before the fetch).
        const demoMembers: TeamMemberRecord[] = getDemoTeamFallback();
        setMembers(demoMembers);
      } else {
        // Live mode: never fabricate a team roster. Show an honest error + empty state.
        setError(err.message || 'Failed to load team members');
        setMembers([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async (payload: { name: string; email: string; teamRole: string }) => {
    if (!accessToken) return;
    const res = await inviteTeamMember(payload, accessToken);
    setMembers(prev => [...prev, res.member]);
    return res.tempPassword;
  };

  const handleRoleChange = async (id: string, teamRole: string) => {
    if (!accessToken) return;
    try {
      const res = await updateTeamMember(id, { teamRole }, accessToken);
      setMembers(prev => prev.map(m => m.id === id ? { ...m, teamRole: res.member.teamRole } : m));
      setEditingId(null);
      showToast('Role updated successfully');
    } catch (err: any) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleRemove = async (id: string) => {
    if (!accessToken) return;
    try {
      await removeTeamMember(id, accessToken);
      setMembers(prev => prev.filter(m => m.id !== id));
      setConfirmRemove(null);
      showToast('Team member removed');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  const stats = {
    total:   members.length,
    active:  members.filter(m => m.status === 'active').length,
    admins:  members.filter(m => m.teamRole === 'admin').length,
    viewers: members.filter(m => m.teamRole === 'viewer').length,
  };

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
          <h1 className="text-3xl font-black text-white mb-1">Team Management</h1>
          <p className="text-white/50 text-sm">Manage team access and permissions via Supabase Auth</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={isLoading}
            className="p-2.5 bg-black/40 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:border-white/20 transition-all"
          >
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm"
          >
            <UserPlus className="size-4" />
            Invite Member
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Users,        label: 'Total Members', value: stats.total,   color: '#8B5CF6' },
          { icon: CheckCircle2, label: 'Active',         value: stats.active,  color: '#10B981' },
          { icon: Crown,        label: 'Admins',         value: stats.admins,  color: '#FB923C' },
          { icon: Eye,          label: 'Viewers',        value: stats.viewers, color: '#06D7F6' },
        ].map(s => (
          <div key={s.label} className="bg-black/40 border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-white/50">{s.label}</span>
              <s.icon className="size-4" style={{ color: s.color }} />
            </div>
            <div className="text-3xl font-black text-white">{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Error / loading ── */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl text-[#FD4438] text-sm">
          <AlertTriangle className="size-4 flex-shrink-0" />
          {error}
          <button onClick={load} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      {/* ── Team list ── */}
      <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-bold text-white">Team Members</h2>
          <span className="text-sm text-white/40">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-8 text-[#8B5CF6] animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="size-12 text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">No team members found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {members.map(member => (
              <MemberRow
                key={member.id}
                member={member}
                isEditing={editingId === member.id}
                onEdit={() => setEditingId(editingId === member.id ? null : member.id)}
                onRoleChange={(role) => handleRoleChange(member.id, role)}
                onRemove={() => setConfirmRemove(member.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Role reference ── */}
      <div className="grid grid-cols-3 gap-4">
        {(Object.entries(ROLE_CONFIG) as [string, typeof ROLE_CONFIG['admin']][]).map(([role, cfg]) => (
          <div key={role} className="bg-black/30 border border-white/8 rounded-xl p-5">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold mb-3 ${cfg.color}`}>
              <cfg.icon className="size-3.5" />
              {cfg.label}
            </div>
            <ul className="space-y-1.5">
              {ROLE_PERMS[role].map(p => (
                <li key={p} className="flex items-start gap-2 text-xs text-white/50">
                  <Check className="size-3 text-white/30 flex-shrink-0 mt-0.5" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ── Invite modal ── */}
      <AnimatePresence>
        {showInvite && (
          <InviteModal
            onClose={() => setShowInvite(false)}
            onInvite={handleInvite}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      {/* ── Confirm remove ── */}
      <AnimatePresence>
        {confirmRemove && (
          <ConfirmRemoveModal
            member={members.find(m => m.id === confirmRemove)!}
            onConfirm={() => handleRemove(confirmRemove)}
            onCancel={() => setConfirmRemove(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Member row ──────────────────────────────────────────────────────────────

function MemberRow({
  member, isEditing, onEdit, onRoleChange, onRemove,
}: {
  member: TeamMemberRecord;
  isEditing: boolean;
  onEdit: () => void;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  const roleCfg = ROLE_CONFIG[member.teamRole] || ROLE_CONFIG.viewer;
  const RoleIcon = roleCfg.icon;
  const initials = member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <motion.div
      layout
      className="px-6 py-5 hover:bg-white/3 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="size-11 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">{initials}</span>
          </div>

          {/* Details */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-white">{member.name}</span>
              {member.isSelf && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[#8B5CF6]/20 text-[#8B5CF6] rounded-full font-bold">YOU</span>
              )}
              {/* Role badge */}
              {isEditing ? (
                <RoleSelector
                  current={member.teamRole}
                  disabled={member.isSelf}
                  onChange={onRoleChange}
                />
              ) : (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-semibold ${roleCfg.color}`}>
                  <RoleIcon className="size-3" />
                  {roleCfg.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-white/40">
              <span className="flex items-center gap-1">
                <Mail className="size-3" />
                {member.email}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {member.lastActive
                  ? `Last active ${new Date(member.lastActive).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : 'Never signed in'}
              </span>
              <span className="flex items-center gap-1">
                <Shield className="size-3" />
                Joined {new Date(member.joinedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!member.isSelf && (
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className={`p-2 rounded-lg transition-colors ${
                isEditing
                  ? 'bg-[#8B5CF6]/20 text-[#8B5CF6]'
                  : 'hover:bg-white/8 text-white/40 hover:text-white'
              }`}
              title="Edit role"
            >
              <Edit2 className="size-4" />
            </button>
            <button
              onClick={onRemove}
              className="p-2 rounded-lg hover:bg-[#FD4438]/10 text-white/30 hover:text-[#FD4438] transition-colors"
              title="Remove member"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Role selector dropdown ──────────────────────────────────────────────────

function RoleSelector({
  current, disabled, onChange,
}: {
  current: string;
  disabled: boolean;
  onChange: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[#8B5CF6]/50 bg-[#8B5CF6]/10 text-[#8B5CF6] hover:bg-[#8B5CF6]/20 transition-colors font-semibold"
      >
        Change Role
        <ChevronDown className="size-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute top-full left-0 mt-1 z-20 bg-[#0D0D18] border border-white/15 rounded-xl shadow-xl overflow-hidden min-w-40"
          >
            {(Object.entries(ROLE_CONFIG) as [string, typeof ROLE_CONFIG['admin']][]).map(([role, cfg]) => (
              <button
                key={role}
                onClick={() => { onChange(role); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                  role === current ? 'text-white' : 'text-white/60'
                }`}
              >
                <cfg.icon className="size-3.5 flex-shrink-0" style={{ color: role === current ? undefined : undefined }} />
                {cfg.label}
                {role === current && <Check className="size-3 ml-auto text-[#8B5CF6]" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Invite modal ────────────────────────────────────────────────────────────

function InviteModal({
  onClose, onInvite, showToast,
}: {
  onClose: () => void;
  onInvite: (p: { name: string; email: string; teamRole: string }) => Promise<string | undefined>;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [teamRole, setTeamRole]   = useState('viewer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tempCreds, setTempCreds] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied]       = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) return;
    setIsSubmitting(true);
    try {
      const pw = await onInvite({ name: name.trim(), email: email.trim(), teamRole });
      if (pw) {
        setTempCreds({ email: email.trim(), password: pw });
      } else {
        showToast(`${name} has been added to the team`, 'success');
        onClose();
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to invite member', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCredentials = () => {
    if (!tempCreds) return;
    navigator.clipboard.writeText(
      `CORTEX Login Credentials\nEmail: ${tempCreds.email}\nPassword: ${tempCreds.password}\nURL: ${window.location.origin}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#0A0A0F] border border-white/15 rounded-2xl w-full max-w-md shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <UserPlus className="size-5 text-[#8B5CF6]" />
            {tempCreds ? 'Member Created' : 'Invite Team Member'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-white/8 rounded-lg transition-colors text-white/40 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {tempCreds ? (
            /* ── Credentials reveal ── */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-[#10B981]/10 border border-[#10B981]/25 rounded-xl">
                <CheckCircle2 className="size-5 text-[#10B981] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#10B981] text-sm mb-1">Account created successfully!</p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Share these temporary credentials with {name}. They can log in and change their password.
                  </p>
                </div>
              </div>

              <div className="bg-black/40 border border-white/10 rounded-xl p-4 font-mono text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-white/40">Email</span>
                  <span className="text-white">{tempCreds.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Password</span>
                  <span className="text-[#FB923C] font-bold">{tempCreds.password}</span>
                </div>
              </div>

              <button
                onClick={copyCredentials}
                className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-colors"
              >
                {copied ? <Check className="size-4 text-[#10B981]" /> : <Copy className="size-4" />}
                {copied ? 'Copied to clipboard!' : 'Copy credentials'}
              </button>

              <button
                onClick={() => { showToast(`${name} added to the team`, 'success'); onClose(); }}
                className="w-full py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          ) : (
            /* ── Invite form ── */
            <span className="contents">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/25 focus:border-[#8B5CF6] focus:outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="jane@yourcompany.com"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/25 focus:border-[#8B5CF6] focus:outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-white mb-2">Role</label>
                <select
                  value={teamRole}
                  onChange={e => setTeamRole(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-[#8B5CF6] focus:outline-none text-sm"
                >
                  <option value="viewer">Viewer — read-only access</option>
                  <option value="reviewer">Reviewer — can edit and send reports</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>

              <div className="p-3.5 bg-[#3B82F6]/8 border border-[#3B82F6]/20 rounded-xl text-xs text-gray-400 leading-relaxed">
                A temporary password will be auto-generated and shown after creation. Share it securely with the new member.
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-semibold text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !name.trim() || !email.trim()}
                  className="flex-1 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  {isSubmitting ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Confirm remove modal ────────────────────────────────────────────────────

function ConfirmRemoveModal({
  member, onConfirm, onCancel,
}: {
  member: TeamMemberRecord;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  const handle = async () => {
    setIsRemoving(true);
    await onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#0A0A0F] border border-[#FD4438]/30 rounded-2xl p-8 max-w-sm w-full shadow-2xl"
      >
        <div className="text-center mb-6">
          <div className="size-14 rounded-full bg-[#FD4438]/10 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="size-6 text-[#FD4438]" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Remove Team Member?</h3>
          <p className="text-gray-400 text-sm leading-relaxed">
            <strong className="text-white">{member.name}</strong> ({member.email}) will lose access to CORTEX immediately.
            This action deletes their Supabase account and cannot be undone.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-semibold text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={isRemoving}
            className="flex-1 py-3 bg-[#FD4438] hover:bg-[#E03530] text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRemoving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {isRemoving ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}