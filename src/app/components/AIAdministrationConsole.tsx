/**
 * AI ADMINISTRATION CONSOLE — AI-01 Batch 2
 *
 * The operator's view of the AI platform: what it is doing, what it is costing,
 * whether it is healthy, and the controls to change any of that.
 *
 * THREE PRINCIPLES THIS COMPONENT IS BUILT ON.
 *
 *   The server decides. `capabilities` arrives on the overview and this
 *   component reads it to decide what to RENDER — a team admin does not see a
 *   kill switch they cannot pull. That is a courtesy, not a control: every
 *   action is refused server-side whether or not the button was drawn, and the
 *   error path below treats a FORBIDDEN response as a normal outcome rather
 *   than an exception, because a stale page is a normal thing to have.
 *
 *   Every change states its reason. The reason prompt is not a confirmation
 *   dialog with extra steps — it is the audit record's `reason` field, and the
 *   server rejects a change without one. Making the operator type it here means
 *   the trail reads like an incident log instead of a list of timestamps.
 *
 *   Destructive controls look destructive. The kill switch and the spend reset
 *   are visually separated from the settings that merely retune behaviour, and
 *   both name their blast radius in the prompt. An operator reaching for the
 *   emergency stop during an incident should not have to remember what it does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bot, CheckCircle2, ChevronRight, CircleSlash,
  Clock, Cpu, DollarSign, FileClock, Gauge, Loader2, Lock, PlayCircle, Power, RefreshCw,
  GitBranch, Server, ShieldAlert, ShieldCheck, Wallet, Workflow, Zap,
} from 'lucide-react';
import {
  AIAdminError,
  fetchAIAdminChanges,
  fetchAIAdminDiagnostics,
  fetchAIAdminOverview,
  fetchAIExecutionAudit,
  formatMicroUsd,
  hasAICapability,
  increaseAISpendCap,
  percentOf,
  resetAISpend,
  setAIEmergencyStop,
  updateAIProvider,
  updateAISettings,
  type AIAdminChangeRecord,
  type AIAdminDiagnostics,
  type AIAdminOverview,
  type AIExecutionAuditRecord,
} from '@/app/services/aiAdminService';
import { ProviderAdministrationPanel } from './ProviderAdministrationPanel';
import { RoutingPanel } from './RoutingPanel';
import {
  AgentRuntimeError,
  decideAgentApproval,
  fetchAgentOverview,
  fetchAgentRegistry,
  formatAgentCost,
  formatElapsed,
  hasAgentCapability,
  type AgentDescriptorView,
  type AgentRuntimeOverview,
} from '@/app/services/agentRuntimeService';
import {
  READINESS_REVIEW_WORKFLOW_ID,
  WorkflowRuntimeError,
  advanceWorkflowRun,
  cancelWorkflowRun,
  decideWorkflowApproval,
  describeWorkflowOutcome,
  fetchWorkflowApprovals,
  fetchWorkflowOverview,
  fetchWorkflowRegistry,
  fetchWorkflowRun,
  fetchWorkflowRuns,
  hasWorkflowCapability,
  isWorkflowTerminal,
  startWorkflowRun,
  type WorkflowApprovalView,
  type WorkflowDescriptorView,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowRuntimeOverview,
} from '@/app/services/workflowRuntimeService';

interface Props {
  accessToken?: string;
}

type TabId =
  | 'overview'
  | 'providers'
  | 'routing'
  | 'agents'
  | 'workflows'
  | 'budget'
  | 'usage'
  | 'settings'
  | 'audit'
  | 'diagnostics';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'overview',    label: 'Overview',    icon: Activity },
  { id: 'providers',   label: 'Providers',   icon: Server },
  { id: 'routing',     label: 'Routing',     icon: GitBranch },
  { id: 'agents',      label: 'Agents',      icon: Bot },
  { id: 'workflows',   label: 'Workflows',   icon: Workflow },
  { id: 'budget',      label: 'Budget',      icon: Wallet },
  { id: 'usage',       label: 'Usage',       icon: BarChart3 },
  { id: 'settings',    label: 'Settings',    icon: Gauge },
  { id: 'audit',       label: 'Audit',       icon: FileClock },
  { id: 'diagnostics', label: 'Diagnostics', icon: Cpu },
];


const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  organization_admin: 'Organization Admin',
  team_admin: 'Team Admin',
};

const STATUS_STYLE: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  unhealthy: 'bg-rose-50 text-rose-700 border-rose-200',
};

const CIRCUIT_STYLE: Record<string, string> = {
  closed: 'text-emerald-600',
  half_open: 'text-amber-600',
  open: 'text-rose-600',
};

/** Relative time, because "3 minutes ago" is what an operator is actually asking. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function AIAdministrationConsole({ accessToken }: Props) {
  const [tab, setTab] = useState<TabId>('overview');
  const [overview, setOverview] = useState<AIAdminOverview | null>(null);
  const [diagnostics, setDiagnostics] = useState<AIAdminDiagnostics | null>(null);
  const [executionAudit, setExecutionAudit] = useState<AIExecutionAuditRecord[]>([]);
  const [changes, setChanges] = useState<AIAdminChangeRecord[]>([]);
  const [agents, setAgents] = useState<AgentRuntimeOverview | null>(null);
  const [agentRegistry, setAgentRegistry] = useState<AgentDescriptorView[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowRuntimeOverview | null>(null);
  const [workflowRegistry, setWorkflowRegistry] = useState<WorkflowDescriptorView[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflowApprovals, setWorkflowApprovals] = useState<WorkflowApprovalView[]>([]);
  const [workflowRun, setWorkflowRun] = useState<WorkflowRunDetail | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  const capabilities = overview?.actor.capabilities;
  const canWriteSettings  = hasAICapability(capabilities, 'ai.admin.settings.write');
  const canWriteProviders = hasAICapability(capabilities, 'ai.admin.provider.write');
  const canWriteBudget    = hasAICapability(capabilities, 'ai.admin.budget.write');
  const canResetBudget    = hasAICapability(capabilities, 'ai.admin.budget.reset');
  const canKillSwitch     = hasAICapability(capabilities, 'ai.admin.killswitch');

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 4_000);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!accessToken) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await fetchAIAdminOverview(accessToken);
      setOverview(next);
    } catch (err) {
      // A refusal is a normal outcome for a console page, not a crash: an
      // operator whose role changed since the tab was opened should be told so,
      // plainly, rather than shown a stack trace.
      const adminError = err instanceof AIAdminError ? err : null;
      setError({
        message: adminError?.message ?? 'The AI administration service is unavailable.',
        forbidden: adminError?.isForbidden ?? false,
      });
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Re-read the whole workflow surface.
   *
   * One function for the four reads, so every control below refreshes the same
   * way and none of them can leave half the tab stale — a page that showed a
   * decided approval next to a run still marked "waiting for a person" would be
   * a page an operator stopped believing.
   *
   * A refusal is reported IN PLACE. The workflow runtime has its own RBAC and
   * its own registry, so "your role does not permit this" and "this deployment
   * has not enabled any workflow" are both normal answers rather than failures
   * of the console, and neither should blank the rest of it.
   *
   * Declared before the effect that calls it: the dependency array is evaluated
   * during render, so a reference below the effect would be read before it is
   * initialised.
   */
  const reloadWorkflows = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [nextOverview, registry, runs, approvals] = await Promise.all([
        fetchWorkflowOverview(accessToken),
        fetchWorkflowRegistry(accessToken).catch(() => [] as WorkflowDescriptorView[]),
        fetchWorkflowRuns(accessToken, { limit: 50 }).catch(() => [] as WorkflowRunSummary[]),
        fetchWorkflowApprovals(accessToken, { limit: 50 }).catch(
          () => [] as WorkflowApprovalView[],
        ),
      ]);
      setWorkflows(nextOverview);
      setWorkflowRegistry(registry);
      setWorkflowRuns(runs);
      setWorkflowApprovals(approvals);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError(
        err instanceof WorkflowRuntimeError ? err.message : 'The workflow runtime is unavailable.',
      );
    }
  }, [accessToken]);

  // Lazily fetched: an operator who never opens the audit tab should not pay
  // for a 200-record read on every page load.
  useEffect(() => {
    if (!accessToken || !overview) return;
    if (tab === 'diagnostics' && !diagnostics) {
      fetchAIAdminDiagnostics(accessToken).then(setDiagnostics).catch(() => undefined);
    }
    if (tab === 'audit' && executionAudit.length === 0 && changes.length === 0) {
      fetchAIExecutionAudit(accessToken, 50).then(setExecutionAudit).catch(() => undefined);
      fetchAIAdminChanges(accessToken, 50).then(setChanges).catch(() => undefined);
    }
    if (tab === 'agents' && !agents) {
      // The agent runtime is a separate surface with its own RBAC, so a refusal
      // here is reported in place rather than blanking the whole console: an
      // operator who may administer providers but not read runs should still
      // see everything else.
      fetchAgentOverview(accessToken)
        .then((next) => {
          setAgents(next);
          setAgentError(null);
        })
        .catch((err: unknown) =>
          setAgentError(
            err instanceof AgentRuntimeError ? err.message : 'The agent runtime is unavailable.',
          ),
        );
      fetchAgentRegistry(accessToken).then(setAgentRegistry).catch(() => undefined);
    }
    if (tab === 'workflows' && !workflows) {
      void reloadWorkflows();
    }
  }, [
    tab,
    accessToken,
    overview,
    diagnostics,
    executionAudit.length,
    changes.length,
    agents,
    workflows,
    reloadWorkflows,
  ]);

  /** Re-read the agent surface after a decision, without touching the rest. */
  const reloadAgents = useCallback(async () => {
    if (!accessToken) return;
    try {
      setAgents(await fetchAgentOverview(accessToken));
      setAgentError(null);
    } catch (err) {
      setAgentError(
        err instanceof AgentRuntimeError ? err.message : 'The agent runtime is unavailable.',
      );
    }
  }, [accessToken]);

  /**
   * Decide a pending approval.
   *
   * The reason prompt is the same discipline every other mutation on this page
   * follows: the server refuses a decision without one, and it is what makes
   * the approval trail read like a record of judgements rather than clicks.
   */
  const decideApproval = useCallback(
    async (runId: string, approvalId: string, decision: 'approve' | 'reject') => {
      const reason = window.prompt(
        `${decision === 'approve' ? 'Approve' : 'Reject'} this agent action.\n\n` +
          'This is recorded on the agent runtime audit trail. State why:',
      );
      if (reason === null) return;
      if (reason.trim().length < 4) {
        notify('A reason of at least four characters is required.', 'error');
        return;
      }
      setBusy(true);
      try {
        await decideAgentApproval(accessToken ?? '', {
          runId,
          approvalId,
          decision,
          reason: reason.trim(),
        });
        await reloadAgents();
        notify(`Approval ${decision === 'approve' ? 'granted' : 'rejected'} and recorded.`);
      } catch (err) {
        notify(
          err instanceof AgentRuntimeError ? err.message : 'The decision could not be recorded.',
          'error',
        );
      } finally {
        setBusy(false);
      }
    },
    [accessToken, notify, reloadAgents],
  );

  // ── Workflow runs (AI-01 Batch 3B) ────────────────────────────────────────
  //
  // Four controls, and every one of them is refused server-side on its own
  // terms whether or not this component drew a button: starting needs
  // `workflow.run.create`, cancelling needs `workflow.run.control`, deciding
  // needs `workflow.approval.decide` AND one of the roles the approval node
  // itself declared. Nothing below asserts a role, a tenant or an authority —
  // the request carries a bearer token and the server resolves the rest.

  /** One error path for every workflow control, so none of them can skip it. */
  const workflowAction = useCallback(
    async (label: string, run: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await run();
        await reloadWorkflows();
        notify(label);
      } catch (err) {
        notify(
          err instanceof WorkflowRuntimeError ? err.message : 'The workflow request failed.',
          'error',
        );
      } finally {
        setBusy(false);
      }
    },
    [notify, reloadWorkflows],
  );

  /**
   * Start the certified diagnostic readiness review for one submission.
   *
   * The submission id is the ONLY thing an operator supplies, because it is the
   * only thing the workflow's declared input contract accepts. The tenant the
   * submission is read under is the operator's own, resolved server-side — an
   * id belonging to another organization simply does not resolve.
   */
  const startReadinessReview = useCallback(async () => {
    const submissionId = window.prompt(
      'Start a diagnostic readiness review.\n\n' +
        'The readiness manager reviews the submission against the deterministic engines and ' +
        'drafts an advisory review. A declared role must approve it before anything is ' +
        'committed.\n\nSubmission id:',
    );
    if (submissionId === null) return;
    if (submissionId.trim() === '') {
      notify('A submission id is required.', 'error');
      return;
    }
    await workflowAction('Review started.', async () => {
      const started = await startWorkflowRun(accessToken ?? '', {
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: submissionId.trim() },
      });
      setWorkflowRun(started);
    });
  }, [accessToken, notify, workflowAction]);

  /**
   * Drive a parked run.
   *
   * Recording a decision does not move the run — a decider is not necessarily
   * permitted to drive one — so this is the operator's half of the loop, and it
   * is a separate control precisely because it needs a different permission.
   */
  const advanceRun = useCallback(
    (workflowRunId: string) =>
      workflowAction('Run advanced.', async () => {
        setWorkflowRun(await advanceWorkflowRun(accessToken ?? '', workflowRunId));
      }),
    [accessToken, workflowAction],
  );

  const cancelRun = useCallback(
    async (workflowRunId: string) => {
      const reason = window.prompt(
        'Cancel this workflow run.\n\n' +
          'The run stops where it is and commits nothing. This is recorded on the run’s ' +
          'transition history. State why:',
      );
      if (reason === null) return;
      if (reason.trim().length < 4) {
        notify('A reason of at least four characters is required.', 'error');
        return;
      }
      await workflowAction('Run cancelled.', async () => {
        setWorkflowRun(
          await cancelWorkflowRun(accessToken ?? '', { workflowRunId, reason: reason.trim() }),
        );
      });
    },
    [accessToken, notify, workflowAction],
  );

  const decideWorkflow = useCallback(
    async (workflowApprovalId: string, decision: 'approve' | 'reject') => {
      const reason = window.prompt(
        `${decision === 'approve' ? 'Approve' : 'Reject'} this diagnostic review.\n\n` +
          'Approving lets the run commit the reviewed readiness result against the submission. ' +
          'Rejecting stops the run and commits nothing. This is recorded against your account ' +
          'on the approval record. State why:',
      );
      if (reason === null) return;
      if (reason.trim().length < 4) {
        notify('A reason of at least four characters is required.', 'error');
        return;
      }
      await workflowAction(
        `Decision recorded — ${decision === 'approve' ? 'approved' : 'rejected'}.`,
        () =>
          decideWorkflowApproval(accessToken ?? '', {
            workflowApprovalId,
            decision,
            reason: reason.trim(),
          }),
      );
    },
    [accessToken, notify, workflowAction],
  );

  /** Open one run's detail. A read, so it needs no reason and no busy guard. */
  const openWorkflowRun = useCallback(
    async (workflowRunId: string) => {
      if (!accessToken) return;
      try {
        setWorkflowRun(await fetchWorkflowRun(accessToken, workflowRunId));
      } catch (err) {
        notify(
          err instanceof WorkflowRuntimeError ? err.message : 'That run could not be read.',
          'error',
        );
      }
    },
    [accessToken, notify],
  );

  /**
   * Run a change, having first asked for its reason.
   *
   * One wrapper for every mutation, so no call site can skip the prompt, the
   * busy guard, the refresh or the error surface — the same reasoning that puts
   * the server's `mutate` behind one door.
   */
  const withReason = useCallback(
    async (prompt: string, run: (reason: string) => Promise<unknown>) => {
      const reason = window.prompt(
        `${prompt}\n\nThis is recorded on the AI administration audit trail. State why:`,
      );
      if (reason === null) return;
      if (reason.trim().length < 4) {
        notify('A reason of at least four characters is required.', 'error');
        return;
      }
      setBusy(true);
      try {
        await run(reason.trim());
        await load(true);
        notify('Change applied and recorded.');
      } catch (err) {
        notify(
          err instanceof AIAdminError ? err.message : 'The change could not be applied.',
          'error',
        );
      } finally {
        setBusy(false);
      }
    },
    [load, notify],
  );

  const health = overview?.health;
  const statusStyle = STATUS_STYLE[health?.status ?? 'unhealthy'] ?? STATUS_STYLE.unhealthy;

  const spendPercent = useMemo(() => {
    const platform = overview?.budget.platform;
    if (!platform) return 0;
    return percentOf(platform.spentMicroUsd + platform.reservedMicroUsd, platform.capMicroUsd);
  }, [overview]);

  // ── Loading, refusal and empty states ─────────────────────────────────────

  if (!accessToken) {
    return (
      <Panel>
        <Empty
          icon={Lock}
          title="Sign in required"
          body="AI administration requires an authenticated team session."
        />
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel>
        <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading AI administration…</span>
        </div>
      </Panel>
    );
  }

  if (error || !overview) {
    return (
      <Panel>
        <Empty
          icon={error?.forbidden ? ShieldAlert : AlertTriangle}
          title={error?.forbidden ? 'Not authorized' : 'Unavailable'}
          body={error?.message ?? 'The AI administration service did not respond.'}
          action={
            error?.forbidden ? undefined : (
              <button
                onClick={() => void load()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            )
          }
        />
      </Panel>
    );
  }

  const { settings, effective, budget, usage, actor } = overview;

  return (
    <Panel>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-slate-500" />
            AI Administration
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Signed in as {ROLE_LABEL[actor.role] ?? actor.role}
            {actor.organizationScope.length > 0
              ? ` · ${actor.organizationScope.join(', ')}`
              : ' · all organizations'}
            {' · '}configuration v{settings.configurationVersion}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusStyle}`}>
            {health?.status ?? 'unknown'}
          </span>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* An engaged emergency stop is the single most important thing on this
          page. It is stated before anything else and it never scrolls away
          behind a tab. */}
      {settings.emergencyStop.engaged && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <CircleSlash className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" />
          <div className="flex-1">
            <p className="font-semibold text-rose-900">Emergency stop engaged — all AI is paused</p>
            <p className="mt-1 text-sm text-rose-800">
              {settings.emergencyStop.reason ?? 'No reason recorded.'}
            </p>
            <p className="mt-1 text-xs text-rose-700">
              Engaged by {settings.emergencyStop.engagedBy ?? 'unknown'} ·{' '}
              {relativeTime(settings.emergencyStop.engagedAt)}
            </p>
          </div>
          {canKillSwitch && (
            <button
              disabled={busy}
              onClick={() =>
                void withReason('Release the emergency stop and resume AI execution.', (reason) =>
                  setAIEmergencyStop(accessToken, false, reason),
                )
              }
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Release
            </button>
          )}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {/* ── Overview ───────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="AI execution"
                value={effective.aiEnabled ? 'Running' : 'Stopped'}
                tone={effective.aiEnabled ? 'good' : 'bad'}
                icon={Power}
              />
              <Stat
                label="Real providers"
                value={effective.realRequestsEnabled ? 'Live' : 'Mock only'}
                tone={effective.realRequestsEnabled ? 'warn' : 'neutral'}
                icon={Zap}
              />
              <Stat
                label="Spend committed"
                value={`${formatMicroUsd(budget.platform.spentMicroUsd + budget.platform.reservedMicroUsd)} / ${formatMicroUsd(budget.platform.capMicroUsd)}`}
                tone={spendPercent >= 90 ? 'bad' : spendPercent >= 70 ? 'warn' : 'good'}
                icon={DollarSign}
              />
              <Stat
                label="Success rate"
                value={`${usage.totals.successRatePercent}%`}
                tone={usage.totals.failureRatePercent > 10 ? 'warn' : 'good'}
                icon={CheckCircle2}
              />
            </div>

            {health && health.issues.length > 0 && (
              <Section title="Open issues">
                <ul className="space-y-2">
                  {health.issues.map((issue) => (
                    <li key={issue} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {canKillSwitch && !settings.emergencyStop.engaged && (
              <Section title="Emergency controls" tone="danger">
                <p className="mb-3 text-sm text-slate-600">
                  The emergency stop refuses every AI request platform-wide, for every
                  organization, immediately. It does not change any other setting — releasing it
                  restores exactly the posture in force now.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void withReason(
                      'Engage the emergency stop. Every AI request across every organization will be refused until it is released.',
                      (reason) => setAIEmergencyStop(accessToken, true, reason),
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <CircleSlash className="h-4 w-4" /> Engage emergency stop
                </button>
              </Section>
            )}
          </div>
        )}

        {/* ── Providers ──────────────────────────────────────────────────── */}
        {tab === 'providers' && (
          <div className="space-y-4">
            {overview.settings.providerPreference.length > 0 && (
              <p className="text-sm text-slate-500">
                Selection order:{' '}
                <span className="font-medium text-slate-700">
                  {effective.providerPreference.join(' → ')}
                </span>
              </p>
            )}

            {/* Rendered from the overview's health block, so the page needs one
                round trip rather than two — and the eligibility reason shown
                here is by construction the same one the health endpoint
                reports. */}
            {/* ── Provider administration (AI-01 Batch 4C) ────────────────
                The canonical provider surface: configuration, credentials,
                models, certification, health and governed exposure. It reads
                its own endpoint and enforces its own capabilities, so it is
                rendered unconditionally and reports a refusal in place — an
                operator who may see operational state but not administer
                providers still gets the selection view below it. */}
            <ProviderAdministrationPanel
              accessToken={accessToken}
              capabilities={capabilities}
              withReason={withReason}
              notify={notify}
              busy={busy}
            />

            {/* The Batch 2 operational view, kept. It answers a different
                question — selection order, allow lists, why the selector would
                skip a provider — and an operator diagnosing a routing problem
                reads this one. Removing it to avoid two provider lists would
                have removed the half that explains selection. */}
            <Section title="Selection and preference">
              <ProviderList
                providers={overview.health.providers}
                selection={overview.health.selection}
                settings={settings}
                canWrite={canWriteProviders}
                busy={busy}
                onToggle={(providerId, enabled) =>
                  void withReason(
                    `${enabled ? 'Enable' : 'Disable'} the ${providerId} provider. This changes which vendor serves every AI request platform-wide.`,
                    (reason) => updateAIProvider(accessToken, providerId, { enabled }, reason),
                  )
                }
                onSetDefault={(providerId) =>
                  void withReason(
                    `Make ${providerId} the default provider, tried ahead of the configured preference order.`,
                    (reason) => updateAISettings(accessToken, { defaultProviderId: providerId }, reason),
                  )
                }
              />
            </Section>
          </div>
        )}

        {/* ── Budget ─────────────────────────────────────────────────────── */}
        {/* ── Routing (AI-01 Batch 4F) ───────────────────────────────────
            Its own tab rather than a card on Providers, because it answers a
            different question. Providers is "what may serve"; this is "what
            does serve, in what order, and what is that costing". */}
        {tab === 'routing' && (
          <RoutingPanel
            accessToken={accessToken}
            capabilities={capabilities}
            withReason={withReason}
            notify={notify}
            busy={busy}
          />
        )}

        {tab === 'budget' && (
          <div className="space-y-6">
            <Section title="MARQ-funded ceiling">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Current spend" value={formatMicroUsd(budget.platform.spentMicroUsd)} />
                <Field label="Reserved (in flight)" value={formatMicroUsd(budget.platform.reservedMicroUsd)} />
                <Field label="Remaining" value={formatMicroUsd(budget.platform.remainingMicroUsd)} />
                <Field label="Ceiling" value={formatMicroUsd(budget.platform.capMicroUsd)} />
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    spendPercent >= 90 ? 'bg-rose-500' : spendPercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${spendPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {spendPercent}% committed · lifetime spend{' '}
                {formatMicroUsd(budget.platform.lifetimeSpentMicroUsd)} across{' '}
                {budget.platform.attemptCount} billable attempt(s) ·{' '}
                {budget.platform.enforced ? 'enforced' : 'NOT enforced'}
              </p>
            </Section>

            <Section title="Reservations">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Open holds" value={String(budget.reservations.openCount)} />
                <Field label="Held" value={formatMicroUsd(budget.reservations.openMicroUsd)} />
                <Field
                  label="Recovered by expiry"
                  value={`${formatMicroUsd(budget.reservations.reclaimedMicroUsd)} (${budget.reservations.reclaimedCount})`}
                />
              </div>
              {budget.reservations.unattributedSince && (
                <p className="mt-3 flex items-center gap-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Reserved money with no owning hold, first seen{' '}
                  {relativeTime(budget.reservations.unattributedSince)}. It is time-boxed and will
                  be reclaimed automatically.
                </p>
              )}
              {budget.reservations.open.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {budget.reservations.open.map((hold) => (
                    <li key={hold.reservationId} className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {formatMicroUsd(hold.reservedMicroUsd)} · {hold.owner ?? 'unknown feature'} ·
                      expires {relativeTime(hold.expiresAt)}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Rolling daily allowances">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Per organization" value={formatMicroUsd(budget.daily.organizationDailyMicroUsd)} />
                <Field label="Per person" value={formatMicroUsd(budget.daily.actorDailyMicroUsd)} />
                <Field label="Alert threshold" value={`${budget.daily.alertThresholdPercent}%`} />
                <Field label="Enforcement" value={budget.daily.enforce ? 'On' : 'Off'} />
              </div>
              {canWriteBudget && (
                <p className="mt-3 text-xs text-slate-500">
                  Daily allowances are editable on the Settings tab.
                </p>
              )}
            </Section>

            {canResetBudget && (
              <Section title="Authorized budget actions" tone="danger">
                <p className="mb-3 text-sm text-slate-600">
                  A <strong>reset</strong> clears settled spend and every open hold; the history is
                  retained, so past spend remains visible. An <strong>increase</strong> raises the
                  ceiling and leaves settled spend exactly where it is.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void withReason(
                        `Reset the platform spend ledger. Settled spend of ${formatMicroUsd(budget.platform.spentMicroUsd)} will be cleared and every open reservation discarded.`,
                        (reason) => resetAISpend(accessToken, reason),
                      )
                    }
                    className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Reset spend ledger
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const raw = window.prompt(
                        `New ceiling in US dollars. The current ceiling is ${formatMicroUsd(budget.platform.capMicroUsd)}.`,
                      );
                      if (raw === null) return;
                      const dollars = Number.parseFloat(raw);
                      if (!Number.isFinite(dollars) || dollars <= 0) {
                        notify('Enter a positive dollar amount.', 'error');
                        return;
                      }
                      void withReason(
                        `Raise the platform AI spending ceiling to $${dollars.toFixed(2)}.`,
                        (reason) =>
                          increaseAISpendCap(accessToken, Math.round(dollars * 1_000_000), reason),
                      );
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Increase ceiling
                  </button>
                </div>
              </Section>
            )}

            {budget.resets.length > 0 && (
              <Section title="Budget change history">
                <ul className="divide-y divide-slate-100">
                  {[...budget.resets].reverse().map((event, index) => (
                    <li key={`${event.at}-${index}`} className="py-3">
                      <p className="text-sm font-medium text-slate-800">
                        {event.kind === 'cap_raise' ? 'Ceiling raised' : 'Ledger reset'} ·{' '}
                        {formatMicroUsd(event.previousCapMicroUsd)} →{' '}
                        {formatMicroUsd(event.newCapMicroUsd)}
                      </p>
                      <p className="text-sm text-slate-600">{event.reason}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {event.authorizedBy} · {relativeTime(event.at)}
                        {event.clearedMicroUsd > 0
                          ? ` · cleared ${formatMicroUsd(event.clearedMicroUsd)}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}

        {/* ── Usage ──────────────────────────────────────────────────────── */}
        {tab === 'usage' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Requests" value={String(usage.totals.requests)} />
              <Field label="Succeeded" value={String(usage.totals.succeeded)} />
              <Field label="Failed" value={String(usage.totals.failed)} />
              <Field label="Retries" value={String(usage.totals.retries)} />
              <Field label="Tokens" value={usage.totals.tokens.toLocaleString()} />
              <Field label="Estimated cost" value={formatMicroUsd(usage.totals.estimatedCostMicroUsd)} />
              <Field label="Actual cost" value={formatMicroUsd(usage.totals.actualCostMicroUsd)} />
              <Field label="Circuit events" value={String(usage.totals.circuitOpenEvents)} />
            </div>

            <p className="text-xs text-slate-500">
              Estimated cost is priced from reported token usage across every provider, including
              the non-billable mock. Actual cost is money settled against the MARQ ceiling. They
              should be close and will not be equal.
            </p>

            <Section title="By feature">
              <Table
                head={['Feature', 'Requests', 'Success', 'Tokens', 'Est. cost']}
                rows={usage.features.map((feature) => [
                  feature.featureId,
                  String(feature.requests),
                  `${feature.successRatePercent}%`,
                  feature.tokens.toLocaleString(),
                  formatMicroUsd(feature.estimatedCostMicroUsd),
                ])}
                empty="No AI requests recorded since this instance started."
              />
            </Section>

            <Section title="By provider">
              <Table
                head={['Provider', 'Attempts', 'Success', 'Failovers', 'p95 latency']}
                rows={usage.providers.map((provider) => [
                  provider.providerId,
                  String(provider.attempts),
                  `${provider.successRatePercent}%`,
                  String(provider.failovers),
                  `${provider.latency.p95}ms`,
                ])}
                empty="No provider attempts recorded."
              />
            </Section>

            {usage.errors.length > 0 && (
              <Section title="Errors">
                <Table
                  head={['Code', 'Count']}
                  rows={usage.errors.map((entry) => [entry.code, String(entry.count)])}
                  empty=""
                />
              </Section>
            )}
          </div>
        )}

        {/* ── Settings ───────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="space-y-6">
            <Section title="Runtime configuration">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Configuration version" value={String(settings.configurationVersion)} />
                <Field label="AI enabled" value={settings.aiEnabled ? 'Yes' : 'No'} />
                <Field label="Real providers requested" value={settings.realRequestsEnabled ? 'Yes' : 'No'} />
                <Field label="Real providers effective" value={effective.realRequestsEnabled ? 'Yes' : 'No'} />
                <Field label="Failover" value={settings.failoverEnabled ? 'Enabled' : 'Disabled'} />
                {/* Three populations, three switches. They were one until a
                    review found that hardening providers silently hardened
                    agents and tools too, so the console now states each
                    separately rather than implying one control. */}
                <Field
                  label="Require certified providers"
                  value={settings.requireCertifiedProviders ? 'Yes' : 'No'}
                />
                <Field
                  label="Require certified agents"
                  value={settings.requireCertifiedAgents ? 'Yes' : 'No'}
                />
                <Field
                  label="Require certified tools"
                  value={settings.requireCertifiedTools ? 'Yes' : 'No'}
                />
                <Field label="Default provider" value={settings.defaultProviderId ?? 'not pinned'} />
                <Field label="Default model" value={settings.defaultModelId ?? 'cheapest capable'} />
                <Field label="Fallback provider" value={settings.fallbackProviderId ?? 'none'} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Last changed by {settings.updatedBy} · {relativeTime(settings.updatedAt)} ·{' '}
                {settings.updatedReason}
              </p>
            </Section>

            <Section title="Retry policy">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Base delay" value={`${settings.retry.baseDelayMs}ms`} />
                <Field label="Maximum delay" value={`${settings.retry.maxDelayMs}ms`} />
                <Field label="Jitter" value={`${settings.retry.jitterPercent}%`} />
              </div>
            </Section>

            <Section title="Timeout policy">
              <Field label="Workflow deadline" value={`${settings.timeout.workflowDeadlineMs}ms`} />
              <p className="mt-2 text-xs text-slate-500">
                Bounds the whole request across every attempt and every provider. Per-attempt
                timeouts are declared per feature and are not administrable.
              </p>
            </Section>

            {canWriteSettings && (
              <Section title="Adjust">
                <div className="flex flex-wrap gap-3">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void withReason(
                        `${settings.failoverEnabled ? 'Disable' : 'Enable'} provider failover.`,
                        (reason) =>
                          updateAISettings(
                            accessToken,
                            { failoverEnabled: !settings.failoverEnabled },
                            reason,
                          ),
                      )
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {settings.failoverEnabled ? 'Disable' : 'Enable'} failover
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const raw = window.prompt(
                        `Workflow deadline in milliseconds (1000–600000). Currently ${settings.timeout.workflowDeadlineMs}.`,
                      );
                      if (raw === null) return;
                      const ms = Number.parseInt(raw, 10);
                      if (!Number.isFinite(ms)) {
                        notify('Enter a number of milliseconds.', 'error');
                        return;
                      }
                      void withReason('Change the whole-workflow deadline.', (reason) =>
                        updateAISettings(accessToken, { timeout: { workflowDeadlineMs: ms } }, reason),
                      );
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Set workflow deadline
                  </button>
                </div>
              </Section>
            )}

            {canKillSwitch && (
              <Section title="AI master switch" tone="danger">
                <p className="mb-3 text-sm text-slate-600">
                  Disabling AI refuses every request platform-wide. Unlike the emergency stop it is
                  an ordinary setting, intended for planned maintenance rather than an incident.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void withReason(
                      `${settings.aiEnabled ? 'Disable' : 'Enable'} AI platform-wide.`,
                      (reason) =>
                        updateAISettings(accessToken, { aiEnabled: !settings.aiEnabled }, reason),
                    )
                  }
                  className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {settings.aiEnabled ? 'Disable AI' : 'Enable AI'}
                </button>
              </Section>
            )}
          </div>
        )}

        {/* ── Audit ──────────────────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div className="space-y-6">
            <p className="text-sm text-slate-500">
              Read-only. Audit records cannot be edited or removed through any interface.
            </p>

            <Section title="Administrative changes">
              <Table
                head={['When', 'Action', 'By', 'Outcome', 'Reason']}
                rows={changes.map((record) => [
                  relativeTime(record.recordedAt),
                  record.action.replace(/^ai\.admin\./, ''),
                  record.actorEmail ?? record.actorId,
                  record.outcome === 'applied' ? 'applied' : `rejected (${record.rejectionCode ?? '—'})`,
                  record.reason,
                ])}
                empty="No administrative changes recorded."
              />
            </Section>

            <Section title="AI execution records">
              <Table
                head={['When', 'Feature', 'Organization', 'Provider', 'Outcome', 'Cost']}
                rows={executionAudit.map((record) => [
                  relativeTime(record.recordedAt),
                  record.featureId,
                  record.organizationId,
                  record.providerId ?? '—',
                  record.outcome === 'success' ? 'success' : `failure (${record.errorCode ?? '—'})`,
                  record.costMicroUsd === undefined ? '—' : formatMicroUsd(record.costMicroUsd),
                ])}
                empty="No AI executions recorded since this instance started."
              />
            </Section>
          </div>
        )}

        {/* ── Agents (AI-01 Batch 3A) ────────────────────────────────────── */}
        {tab === 'agents' && (
          <div className="space-y-6">
            {agentError ? (
              <Empty
                icon={ShieldAlert}
                title="Agent runtime unavailable"
                body={agentError}
              />
            ) : !agents ? (
              <div className="flex items-center gap-2 py-8 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading agent runs…
              </div>
            ) : (
              <>
                <Section title="Runs">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                      label="Active runs"
                      value={String(agents.active.length)}
                      tone="neutral"
                      icon={Activity}
                    />
                    <Stat
                      label="Awaiting approval"
                      value={String(agents.pendingApprovals.length)}
                      tone={agents.pendingApprovals.length > 0 ? 'warn' : 'good'}
                      icon={Lock}
                    />
                    <Stat
                      label="Completed"
                      value={String(agents.counts.completed ?? 0)}
                      tone="good"
                      icon={CheckCircle2}
                    />
                    <Stat
                      label="Failed or stopped"
                      value={String(agents.recentFailures.length)}
                      tone={agents.recentFailures.length > 0 ? 'bad' : 'good'}
                      icon={AlertTriangle}
                    />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {agents.registeredAgents} registered agents · {agents.registeredTools}{' '}
                    registered tools · scope {agents.scope}
                  </p>
                </Section>

                <Section title="Active runs">
                  <Table
                    head={['Run', 'Agent', 'State', 'Step', 'Elapsed', 'Tokens', 'Cost']}
                    rows={agents.active.map((run) => [
                      run.runId,
                      run.currentAgentId,
                      run.state,
                      `${run.currentStep}`,
                      formatElapsed(run.elapsedRuntimeMs),
                      String(run.totalTokens),
                      formatAgentCost(run.costMicroUsd),
                    ])}
                    empty="No agent runs are in flight."
                  />
                </Section>

                {agents.pendingApprovals.length > 0 && (
                  <Section title="Approvals waiting">
                    <ul className="space-y-3">
                      {agents.pendingApprovals.map((approval) => (
                        <li
                          key={approval.approvalId}
                          className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                        >
                          <p className="font-medium text-amber-900">{approval.impactSummary}</p>
                          <p className="mt-1 text-sm text-amber-800">{approval.reason}</p>
                          <p className="mt-1 text-xs text-amber-700">
                            {approval.requestingAgentId} · {approval.actionType} · run{' '}
                            {approval.runId} · expires {relativeTime(approval.expiresAt)} ·{' '}
                            {approval.dataAffected.join(', ') || 'no data listed'}
                          </p>
                          {hasAgentCapability(agents.capabilities, 'agent.approval.decide') && (
                            <div className="mt-3 flex gap-2">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void decideApproval(approval.runId, approval.approvalId, 'approve')
                                }
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void decideApproval(approval.runId, approval.approvalId, 'reject')
                                }
                                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section title="Recent failures and limits">
                  <Table
                    head={['Run', 'Agent', 'State', 'Reason', 'Steps', 'Cost']}
                    rows={agents.recentFailures.map((run) => [
                      run.runId,
                      run.currentAgentId,
                      run.state,
                      run.failure ?? run.failureMessage ?? '—',
                      String(run.stepCount),
                      formatAgentCost(run.costMicroUsd),
                    ])}
                    empty="No agent run has failed or been stopped."
                  />
                </Section>

                <Section title="Registered agents">
                  <Table
                    head={['Agent', 'Version', 'Status', 'Safety', 'Steps', 'Tools', 'Handoffs']}
                    rows={agentRegistry.map((agent) => [
                      agent.agentId,
                      agent.version,
                      agent.enabled ? agent.certification : 'disabled',
                      agent.safetyClass,
                      String(agent.limits.maxTotalSteps ?? 0),
                      agent.allowedTools.join(', ') || '—',
                      agent.allowedHandoffTargets.join(', ') || '—',
                    ])}
                    empty="No agents are registered. Business agents arrive in a later batch."
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Agents propose. The orchestrator decides. The AI Control Plane executes — every
                    model step a run takes goes through the same governed path as every other AI
                    feature.
                  </p>
                </Section>
              </>
            )}
          </div>
        )}

        {/* ── Workflows (AI-01 Batch 3B) ─────────────────────────────────── */}
        {tab === 'workflows' && (
          <WorkflowsTab
            overview={workflows}
            registry={workflowRegistry}
            runs={workflowRuns}
            approvals={workflowApprovals}
            selected={workflowRun}
            error={workflowError}
            busy={busy}
            onStart={startReadinessReview}
            onOpen={openWorkflowRun}
            onAdvance={advanceRun}
            onCancel={cancelRun}
            onDecide={decideWorkflow}
            onDismissSelected={() => setWorkflowRun(null)}
          />
        )}

        {/* ── Diagnostics ────────────────────────────────────────────────── */}
        {tab === 'diagnostics' && (
          <div className="space-y-6">
            {!diagnostics ? (
              <div className="flex items-center gap-2 py-8 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading diagnostics…
              </div>
            ) : (
              <>
                <Section title="Versions">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="AI platform" value={diagnostics.versions.platformVersion} />
                    <Field label="Contract" value={diagnostics.versions.contractVersion} />
                    <Field label="Configuration" value={`v${diagnostics.versions.configurationVersion}`} />
                  </div>
                </Section>

                <Section title="Environment">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field
                      label="Real requests permitted"
                      value={diagnostics.environment.realRequestsPermittedByEnvironment ? 'Yes' : 'No'}
                    />
                    <Field
                      label="Real requests effective"
                      value={diagnostics.environment.realRequestsEffective ? 'Yes' : 'No'}
                    />
                    <Field label="Durable spend ledger" value={diagnostics.environment.spendDurable ? 'Yes' : 'No'} />
                    <Field label="Durable audit" value={diagnostics.environment.auditDurable ? 'Yes' : 'No'} />
                    <Field label="Audit retention" value={`${diagnostics.environment.auditRetentionDays} days`} />
                    <Field label="PII redaction" value={diagnostics.environment.redactionEnabled ? 'On' : 'Off'} />
                    <Field label="Strict input guard" value={diagnostics.environment.strictInputGuard ? 'On' : 'Off'} />
                    <Field label="Log level" value={diagnostics.environment.logLevel} />
                    <Field label="Default organization" value={diagnostics.environment.defaultOrganizationId} />
                  </div>
                </Section>

                <Section title="Circuit breakers">
                  <Table
                    head={['Provider', 'Circuit', 'Consecutive failures', 'Last failure', 'Last recovery']}
                    rows={diagnostics.circuits.map((circuit) => [
                      circuit.providerId,
                      circuit.state,
                      String(circuit.consecutiveFailures),
                      relativeTime(circuit.lastFailureAt),
                      relativeTime(circuit.lastRecoveryAt),
                    ])}
                    empty="No providers registered."
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Opens after {diagnostics.circuitPolicy.failureThreshold} consecutive failures ·
                    cools down for {diagnostics.circuitPolicy.openMs}ms ·{' '}
                    {diagnostics.circuitPolicy.halfOpenSuccessesToClose} probe successes to close.
                  </p>
                </Section>

                <Section title="Rate limits">
                  <Table
                    head={['Feature', 'Per person', 'Per organization', 'Weight']}
                    rows={diagnostics.rateLimits.map((limit) => [
                      limit.featureId,
                      `${limit.perActor.limit} / ${limit.perActor.windowMs / 1000}s`,
                      `${limit.perOrganization.limit} / ${limit.perOrganization.windowMs / 1000}s`,
                      String(limit.rateLimitCost),
                    ])}
                    empty="No features registered."
                  />
                </Section>

                <Section title="Prompt versions">
                  <ul className="space-y-1 font-mono text-xs text-slate-600">
                    {diagnostics.versions.prompts.map((prompt) => (
                      <li key={prompt.reference}>
                        {prompt.reference} · {prompt.fingerprint}
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}
    </Panel>
  );
}

// ── Presentational pieces ───────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6">{children}</div>;
}

function Section({
  title,
  tone = 'default',
  children,
}: {
  title: string;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        tone === 'danger' ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/50'
      }`}
    >
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  icon: typeof Activity;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'bad'
          ? 'text-rose-600'
          : 'text-slate-500';
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${toneClass}`} />
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className={`mt-2 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: string[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            {head.map((cell) => (
              <th key={cell} className="pb-2 pr-4 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-4 text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Activity;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-8 w-8 text-slate-300" />
      <p className="mt-3 font-semibold text-slate-800">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>
      {action}
    </div>
  );
}

/**
 * The workflow operator surface (AI-01 Batch 3B).
 *
 * Deliberately a TAB on the console that already exists rather than a page of
 * its own. What an operator needs here is small and entirely operational —
 * start a review, see where it is, answer the question it parked on, read what
 * it produced, stop one that should not continue — and every one of those is
 * the same shape as the agent tab beside it.
 *
 * THREE THINGS THIS COMPONENT DOES NOT DO.
 *
 *   It decides nothing. `capabilities` arrives on the overview and is read to
 *   decide what to RENDER. An operator who cannot start a run is not shown a
 *   start button; if they were, the server would refuse them anyway. Hiding a
 *   control is a courtesy, never a control.
 *
 *   It knows nothing about the review. The subject of an approval is whatever
 *   the run put on the record — a submission id and a digest — and this
 *   component renders those two strings without understanding either. It cannot
 *   show a draft, because a draft never reaches this surface.
 *
 *   It invents no state. A deployment with the diagnostic capability switched
 *   off has an empty registry, and this says exactly that rather than offering
 *   a button that would 404.
 */
function WorkflowsTab({
  overview,
  registry,
  runs,
  approvals,
  selected,
  error,
  busy,
  onStart,
  onOpen,
  onAdvance,
  onCancel,
  onDecide,
  onDismissSelected,
}: {
  overview: WorkflowRuntimeOverview | null;
  registry: WorkflowDescriptorView[];
  runs: WorkflowRunSummary[];
  approvals: WorkflowApprovalView[];
  selected: WorkflowRunDetail | null;
  error: string | null;
  busy: boolean;
  onStart: () => void;
  onOpen: (workflowRunId: string) => void;
  onAdvance: (workflowRunId: string) => void;
  onCancel: (workflowRunId: string) => void;
  onDecide: (workflowApprovalId: string, decision: 'approve' | 'reject') => void;
  onDismissSelected: () => void;
}) {
  if (error) {
    return <Empty icon={ShieldAlert} title="Workflow runtime unavailable" body={error} />;
  }
  if (!overview) {
    return (
      <div className="flex items-center gap-2 py-8 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workflow runs…
      </div>
    );
  }

  const canStart = hasWorkflowCapability(overview.capabilities, 'workflow.run.create');
  const canControl = hasWorkflowCapability(overview.capabilities, 'workflow.run.control');
  const canDecide = hasWorkflowCapability(overview.capabilities, 'workflow.approval.decide');
  const review = registry.find((entry) => entry.workflowId === READINESS_REVIEW_WORKFLOW_ID);
  const failures = runs.filter((run) =>
    ['failed', 'cancelled', 'expired', 'policy_denied'].includes(run.state),
  );

  return (
    <div className="space-y-6">
      <Section title="Runs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Active runs"
            value={String(overview.active.length)}
            tone="neutral"
            icon={Activity}
          />
          <Stat
            label="Waiting for a person"
            value={String(overview.pendingApprovals)}
            tone={overview.pendingApprovals > 0 ? 'warn' : 'good'}
            icon={Lock}
          />
          <Stat
            label="Completed"
            value={String(overview.counts.completed ?? 0)}
            tone="good"
            icon={CheckCircle2}
          />
          <Stat
            label="Failed or stopped"
            value={String(failures.length)}
            tone={failures.length > 0 ? 'bad' : 'good'}
            icon={AlertTriangle}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {overview.registeredWorkflows} registered workflow
          {overview.registeredWorkflows === 1 ? '' : 's'} · scope {overview.scope} ·{' '}
          {overview.organizationId}
        </p>
      </Section>

      {/* ── The one certified business workflow ─────────────────────────── */}
      <Section title="Diagnostic readiness review">
        {review ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-medium text-slate-900">{review.displayName}</p>
              <p className="mt-1 text-sm text-slate-600">{review.purpose}</p>
              <p className="mt-2 text-xs text-slate-500">
                v{review.version} · {review.certification} ·{' '}
                {review.enabled ? 'enabled' : 'disabled'} · {review.nodeCount} nodes ·{' '}
                {review.approvalCount} approval barrier
                {review.approvalCount === 1 ? '' : 's'} · {review.owner}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Human initiated. Nothing schedules this — a review runs because somebody with the
                operator role asked for one, and it commits nothing until a declared role approves
                it.
              </p>
            </div>
            {canStart && (
              <button
                disabled={busy}
                onClick={onStart}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <PlayCircle className="h-4 w-4" /> Start a review
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-600">
              The diagnostic readiness review is not enabled in this deployment.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The capability is certified but activation is a separate, deliberate decision:
              <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">
                AI_DIAGNOSTIC_REVIEW_ENABLED
              </code>
              is off by default, and nothing is registered without it, without durable storage and
              without a submission source. Until then this surface cannot start one.
            </p>
          </div>
        )}
      </Section>

      {/* ── Decisions waiting on a person ───────────────────────────────── */}
      {approvals.length > 0 && (
        <Section title="Approvals waiting">
          <ul className="space-y-3">
            {approvals.map((approval) => (
              <li
                key={approval.workflowApprovalId}
                className="rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <p className="font-medium text-amber-900">{approval.impactSummary}</p>
                <p className="mt-1 text-sm text-amber-800">{approval.reason}</p>
                {/*
                  WHAT IS BEING APPROVED. Without these two the entry names a run
                  and some definition-authored prose, and a decider has to go and
                  find the subject somewhere else before they can know what they
                  are granting. The digest is a fingerprint of the sealed draft —
                  never its content — which is why it is safe in front of an
                  audience wider than the run itself.
                */}
                {approval.subjectEvidence ? (
                  <p className="mt-2 text-xs text-amber-900">
                    Subject{' '}
                    <span className="font-mono font-semibold">
                      {approval.subjectEvidence.subjectId}
                    </span>{' '}
                    · sealed content{' '}
                    <span className="font-mono">{approval.subjectEvidence.contentDigest}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-amber-900">
                    This request names no subject. Read the run before deciding.
                  </p>
                )}
                <p className="mt-1 text-xs text-amber-700">
                  {approval.workflowId} · node {approval.nodeId} · run {approval.workflowRunId} ·
                  requested by {approval.requestedBy} · expires{' '}
                  {relativeTime(approval.expiresAt)} · answerable by{' '}
                  {approval.authorizedRoles.join(', ')}
                </p>
                {canDecide ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => onDecide(approval.workflowApprovalId, 'approve')}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => onDecide(approval.workflowApprovalId, 'reject')}
                      className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-amber-700">
                    Your role may read this queue and may not answer it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Every run this tenant has, and what can still be done to it ── */}
      <Section title="Workflow runs">
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No workflow run has been started.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {runs.map((run) => (
              <li
                key={run.workflowRunId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-slate-800">{run.workflowRunId}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {run.workflowId} · {run.state}
                    {run.currentNodeId ? ` at ${run.currentNodeId}` : ''} · {run.stepCount} step
                    {run.stepCount === 1 ? '' : 's'} · started by {run.actorId} ·{' '}
                    {relativeTime(run.updatedAt)}
                    {run.failure ? ` · ${run.failure}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => onOpen(run.workflowRunId)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Open
                  </button>
                  {/*
                    A decision does not move the run — a decider is not
                    necessarily permitted to drive one — so advancing is a
                    separate control behind a separate permission.
                  */}
                  {canStart && !isWorkflowTerminal(run.state) && (
                    <button
                      disabled={busy}
                      onClick={() => onAdvance(run.workflowRunId)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Advance
                    </button>
                  )}
                  {canControl && !isWorkflowTerminal(run.state) && (
                    <button
                      disabled={busy}
                      onClick={() => onCancel(run.workflowRunId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <CircleSlash className="h-3.5 w-3.5" /> Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── One run, and what it produced ───────────────────────────────── */}
      {selected && (
        <Section title="Run detail">
          <div className="flex items-start justify-between gap-4">
            <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Run" value={selected.workflowRunId} />
              <Field label="State" value={selected.state} />
              <Field label="Outcome" value={describeWorkflowOutcome(selected)} />
              <Field label="Workflow" value={`${selected.workflowId} v${selected.workflowVersion}`} />
              <Field label="Input digest" value={selected.inputDigest} />
              <Field label="Result digest" value={selected.resultDigest ?? '—'} />
              <Field label="Tokens" value={String(selected.actualTotalTokens)} />
              <Field label="Cost" value={formatAgentCost(selected.actualCostMicroUsd)} />
              <Field label="Elapsed" value={formatElapsed(selected.elapsedRuntimeMs)} />
            </div>
            <button
              onClick={onDismissSelected}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>

          <div className="mt-5">
            <Table
              head={['Node', 'Kind', 'Outcome', 'When', 'Failure']}
              rows={selected.steps.map((step) => [
                step.nodeId,
                step.kind,
                step.outcome,
                relativeTime(step.startedAt),
                step.failure ?? '—',
              ])}
              empty="This run has completed no node yet."
            />
          </div>

          {/*
            The join key into the agent runtime's own view. Every node of a
            workflow is a child agent run, governed by the agent runtime's RBAC,
            limits and audit trail — so "what did this workflow actually do" is
            answered over there, and this is how an operator gets there.
          */}
          <p className="mt-3 text-xs text-slate-500">
            Child agent runs:{' '}
            {selected.childAgentRunIds.length === 0
              ? 'none yet'
              : selected.childAgentRunIds.join(', ')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The run’s input and every node output stay on the server. What travels here is
            identity, state and digests — a fingerprint of content is never content.
          </p>
        </Section>
      )}
    </div>
  );
}

/**
 * Provider rows.
 *
 * Split out because it is the one part of this console with real per-row state
 * and per-row authorization: a provider that is disabled shows why it was
 * skipped, and the enable/disable control only exists for an operator whose
 * role can actually use it.
 */
function ProviderList({
  providers,
  selection,
  settings,
  canWrite,
  busy,
  onToggle,
  onSetDefault,
}: {
  providers: AIAdminOverview['health']['providers'];
  selection: AIAdminOverview['health']['selection'];
  settings: AIAdminOverview['settings'];
  canWrite: boolean;
  busy: boolean;
  onToggle: (providerId: string, enabled: boolean) => void;
  onSetDefault: (providerId: string) => void;
}) {
  if (!providers || providers.length === 0) {
    return <p className="text-sm text-slate-500">No AI providers are registered.</p>;
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => {
        const setting = settings.providers[provider.providerId];
        const enabled = setting?.enabled ?? provider.state !== 'disabled';
        return (
          <div
            key={provider.providerId}
            className="rounded-xl border border-slate-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-semibold text-slate-900">
                  {provider.providerId}
                  {settings.defaultProviderId === provider.providerId && (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">
                      default
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  state {provider.state} · certification {provider.certification} · circuit{' '}
                  <span className={CIRCUIT_STYLE[provider.circuit] ?? ''}>{provider.circuit}</span>
                  {' · '}
                  credentials {provider.credentialsConfigured ? 'configured' : 'missing'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  selection:{' '}
                  <span
                    className={
                      selection[provider.providerId] === 'eligible'
                        ? 'text-emerald-600'
                        : 'text-amber-700'
                    }
                  >
                    {selection[provider.providerId] ?? 'not evaluated'}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {provider.successCount} ok · {provider.failureCount} failed · last failure{' '}
                  {relativeTime(provider.lastFailureAt)} · last recovery{' '}
                  {relativeTime(provider.lastRecoveryAt)}
                </p>
                {provider.lastError && (
                  <p className="mt-1 text-xs text-rose-600">{provider.lastError}</p>
                )}
              </div>

              {canWrite && (
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => onToggle(provider.providerId, !enabled)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                  {settings.defaultProviderId !== provider.providerId && (
                    <button
                      disabled={busy}
                      onClick={() => onSetDefault(provider.providerId)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Make default <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
