/**
 * WHAT THE ORGANIZATION IS TRYING TO DO — goals, decisions and risks.
 *
 * ONT 13.4, 14.8 and 17.6, on one screen, because they only mean anything
 * together: a goal with no risks against it has not been thought about, and a
 * decision that serves no goal is a change of direction nobody wrote down.
 *
 * ── THE TWO NUMBERS THAT ARE OPINIONS ──────────────────────────────────────
 *
 * "Decisions with no rationale" and "risks not yet assessed" are not neutral
 * counts. They are the canon's own standard turned into something visible:
 * ONT 14.8 lists JUSTIFIED among a Decision's defining characteristics, and
 * ONT 17.6 says a Risk is EVALUATED by likelihood, impact and tolerance. A
 * record missing those is an incomplete record of the thing, and a surface
 * that displayed it identically to a complete one would be quietly saying they
 * are the same.
 *
 * Every tool records decisions. Very few make the unjustified ones visible.
 *
 * ── WHAT IT SHOWS AND WHAT IT WITHHOLDS ────────────────────────────────────
 *
 * Reading is open to any member; recording needs `strategy.manage`, which only
 * an organization administrator holds. So the controls are gated on the
 * server's answer and WITHHELD rather than disabled — a disabled button
 * promises that signing in differently would help, which is true for a team
 * member and false for a suspended membership.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, GitBranch, Pencil, Plus, Scale, Target,
} from 'lucide-react';
import {
  archiveStrategyRecord,
  createStrategyRecord,
  getStrategy,
  updateStrategyRecord,
} from '@/app/services/dataService';
import { useProductData } from '@/app/hooks/useProductData';
import { ProductDataState } from '@/app/components/ProductDataState';
import { StrategyRecordForm, type StrategyRecord } from '@/app/components/StrategyRecordForm';
import type { StrategyEntityPath, StrategyResponse } from '@/app/lib/api';

interface Props {
  accessToken?: string;
}

const EMPTY: StrategyResponse['strategy'] = { goals: [], decisions: [], risks: [] };

/** "Nothing yet" means no goals, no decisions AND no risks. */
function hasNothingRecorded(response: StrategyResponse): boolean {
  const s = response?.strategy;
  if (!s) return true;
  return s.goals.length === 0 && s.decisions.length === 0 && s.risks.length === 0;
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', on_hold: 'On hold',
  under_review: 'Under review', completed: 'Completed', cancelled: 'Cancelled',
  proposed: 'Proposed', decided: 'Decided', superseded: 'Superseded',
  open: 'Open', mitigating: 'Mitigating', accepted: 'Accepted', closed: 'Closed',
};

const SEVERITY_CLASS: Record<string, string> = {
  low: 'text-white/50',
  medium: 'text-cortex-warning',
  high: 'text-cortex-danger',
};

function Tile({ value, label, tone }: { value: number; label: string; tone?: 'warn' }) {
  return (
    <div className="rounded-cortex-md border border-cortex-default bg-cortex-raised px-4 py-3">
      <p className={`text-xl font-black leading-none ${tone === 'warn' && value > 0 ? 'text-cortex-warning' : 'text-white'}`}>
        {value}
      </p>
      <p className="text-xs text-white/50 mt-1">{label}</p>
    </div>
  );
}

function Actions({ label, onEdit, onArchive, busy }: {
  label: string; onEdit: () => void; onArchive: () => void; busy?: boolean;
}) {
  return (
    <span className="ml-auto inline-flex items-center gap-1 shrink-0">
      <button
        type="button" onClick={onEdit} aria-label={`Edit ${label}`}
        className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/5 transition-colors"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button" onClick={onArchive} disabled={busy} aria-label={`Archive ${label}`}
        className="p-1.5 rounded text-white/40 hover:text-cortex-danger hover:bg-white/5 transition-colors disabled:opacity-40"
      >
        <Archive className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

function Section({ icon: Icon, title, count, children, onAdd, addLabel }: {
  icon: typeof Target; title: string; count: number; children: React.ReactNode;
  onAdd?: () => void; addLabel: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-cortex-accent" aria-hidden="true" />
        <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">
          {title} ({count})
        </h3>
        {onAdd && (
          <button
            type="button" onClick={onAdd} data-testid={`strategy-add-${addLabel}`}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-cortex-md bg-cortex-raised border border-cortex-default text-white/80 hover:text-white hover:border-cortex-strong transition-colors"
          >
            <Plus className="size-3" aria-hidden="true" />
            Add
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function StrategySurface({ accessToken }: Props) {
  const strategy = useProductData<StrategyResponse>(
    () => getStrategy(accessToken || '') as Promise<StrategyResponse>,
    [accessToken],
    { skip: !accessToken, isEmpty: hasNothingRecorded },
  );

  const records = strategy.data?.strategy ?? EMPTY;
  const summary = strategy.data?.summary;
  const people = useMemo(() => strategy.data?.people ?? [], [strategy.data]);
  // Absent reads as FALSE: a backend that did not report the flag has not said
  // the operator may write.
  const canManage = strategy.data?.canManageStrategy === true;

  const [editor, setEditor] = useState<
    { entity: StrategyEntityPath; record: StrategyRecord | null } | null
  >(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const personName = useCallback((id: string | null) => {
    if (id === null) return 'Nobody';
    return people.find(p => p.id === id)?.fullName ?? '—';
  }, [people]);

  const goalStatement = useCallback((id: string | null) => {
    if (id === null) return null;
    return records.goals.find(g => g.id === id)?.statement ?? null;
  }, [records.goals]);

  const save = useCallback(async (payload: Record<string, unknown>) => {
    if (!editor || !accessToken) return;
    if (editor.record) {
      await updateStrategyRecord(editor.entity, editor.record.id, payload, accessToken);
    } else {
      await createStrategyRecord(editor.entity, payload, accessToken);
    }
    // Re-read from the server rather than patching local state: a decision can
    // change what a goal looks like, and a nearly-right screen is the worst of
    // the three options.
    setEditor(null);
    strategy.reload();
  }, [editor, accessToken, strategy]);

  const archive = useCallback(async (
    entity: StrategyEntityPath, id: string, statement: string,
  ) => {
    if (!accessToken) return;
    if (!window.confirm(`Archive "${statement}"? It stops appearing in the strategy.`)) return;
    setArchiving(id);
    setActionError(null);
    try {
      await archiveStrategyRecord(entity, id, accessToken);
      strategy.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That record could not be archived.');
    } finally {
      setArchiving(null);
    }
  }, [accessToken, strategy]);

  const add = (entity: StrategyEntityPath) =>
    canManage ? () => setEditor({ entity, record: null }) : undefined;

  return (
    <div className="p-6 space-y-6" data-testid="strategy-surface">
      <header>
        <h1 className="text-3xl font-black text-white mb-1">Strategy</h1>
        <p className="text-white/50 text-sm">
          What this organization is trying to achieve, what it has decided, and what threatens it.
        </p>
      </header>

      {actionError && (
        <p
          role="alert" data-testid="strategy-action-error"
          className="text-sm text-cortex-danger bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md px-3 py-2"
        >
          {actionError}
        </p>
      )}

      <ProductDataState
        loading={strategy.loading}
        reason={strategy.reason}
        detail={strategy.detail}
        empty={strategy.isEmpty}
        subject="strategy"
        emptyHint="No goals, decisions or risks have been recorded for this organization yet."
        onRetry={strategy.reload}
      >
        <div className="space-y-8">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="strategy-summary">
              <Tile value={summary.goals} label="Goals" />
              <Tile value={summary.goalsWithoutOwner} label="Goals with no owner" tone="warn" />
              {/* The canon's standard, made visible. ONT 14.8: justified. */}
              <Tile
                value={summary.decisionsWithoutRationale}
                label="Decisions with no rationale"
                tone="warn"
              />
              <Tile value={summary.risksOutsideTolerance} label="Risks outside tolerance" tone="warn" />
            </div>
          )}

          {/* ── Goals ── */}
          <Section
            icon={Target} title="Goals" count={records.goals.length}
            onAdd={add('goals')} addLabel="goals"
          >
            <ul className="rounded-cortex-md border border-cortex-default bg-cortex-raised overflow-hidden">
              {records.goals.map(goal => (
                <li
                  key={goal.id} data-testid="strategy-goal"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-cortex-default last:border-b-0"
                >
                  <span className="font-medium text-white">{goal.statement}</span>
                  {goal.measure && (
                    <span className="text-xs text-white/50">
                      {goal.measure}{goal.targetValue ? `: ${goal.targetValue}` : ''}
                    </span>
                  )}
                  <span className="text-xs text-white/40">
                    {STATUS_LABEL[goal.status] ?? goal.status}
                  </span>
                  <span className="text-xs text-white/40">Owner: {personName(goal.ownerPersonId)}</span>
                  {goal.dueOn && <span className="text-xs text-white/40">Due {goal.dueOn}</span>}
                  {canManage && (
                    <Actions
                      label={goal.statement}
                      onEdit={() => setEditor({ entity: 'goals', record: goal })}
                      onArchive={() => archive('goals', goal.id, goal.statement)}
                      busy={archiving === goal.id}
                    />
                  )}
                </li>
              ))}
              {records.goals.length === 0 && (
                <li className="px-4 py-3 text-sm text-white/30">No goals recorded.</li>
              )}
            </ul>
          </Section>

          {/* ── Decisions ── */}
          <Section
            icon={GitBranch} title="Decisions" count={records.decisions.length}
            onAdd={add('decisions')} addLabel="decisions"
          >
            <ul className="space-y-2">
              {records.decisions.map(decision => (
                <li
                  key={decision.id} data-testid="strategy-decision"
                  className="rounded-cortex-md border border-cortex-default bg-cortex-raised px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-white">{decision.statement}</span>
                    <span className="text-xs text-white/40">
                      {STATUS_LABEL[decision.status] ?? decision.status}
                    </span>
                    {decision.decidedOn && (
                      <span className="text-xs text-white/40">
                        {personName(decision.decidedByPersonId)} · {decision.decidedOn}
                      </span>
                    )}
                    {canManage && (
                      <Actions
                        label={decision.statement}
                        onEdit={() => setEditor({ entity: 'decisions', record: decision })}
                        onArchive={() => archive('decisions', decision.id, decision.statement)}
                        busy={archiving === decision.id}
                      />
                    )}
                  </div>
                  {goalStatement(decision.goalId) && (
                    <p className="text-xs text-white/40 mt-1">
                      Serves: {goalStatement(decision.goalId)}
                    </p>
                  )}
                  {decision.alternatives && (
                    <p className="text-xs text-white/40 mt-1">
                      Alternatives: {decision.alternatives}
                    </p>
                  )}
                  {decision.rationale ? (
                    <p className="text-sm text-white/70 mt-2">{decision.rationale}</p>
                  ) : (
                    // ONT 14.8's "justified", said out loud. A decision with no
                    // rationale is an incomplete record of one, and showing it
                    // identically to a complete one would say they are the same.
                    <p
                      data-testid="decision-unjustified"
                      className="text-xs text-cortex-warning mt-2 inline-flex items-center gap-1"
                    >
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      No rationale recorded
                    </p>
                  )}
                </li>
              ))}
              {records.decisions.length === 0 && (
                <li className="text-sm text-white/30">No decisions recorded.</li>
              )}
            </ul>
          </Section>

          {/* ── Risks ── */}
          <Section
            icon={Scale} title="Risks" count={records.risks.length}
            onAdd={add('risks')} addLabel="risks"
          >
            <ul className="space-y-2">
              {records.risks.map(risk => (
                <li
                  key={risk.id} data-testid="strategy-risk"
                  className="rounded-cortex-md border border-cortex-default bg-cortex-raised px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-white">{risk.statement}</span>
                    <span className={`text-xs ${SEVERITY_CLASS[risk.likelihood] ?? 'text-white/40'}`}>
                      Likelihood: {risk.likelihood}
                    </span>
                    <span className={`text-xs ${SEVERITY_CLASS[risk.impact] ?? 'text-white/40'}`}>
                      Impact: {risk.impact}
                    </span>
                    <span
                      data-tolerance={risk.tolerance}
                      className={`text-xs ${risk.tolerance === 'outside' ? 'text-cortex-danger' : 'text-white/40'}`}
                    >
                      {risk.tolerance === 'unset' ? 'Not yet assessed' : `${risk.tolerance} tolerance`}
                    </span>
                    <span className="text-xs text-white/40">
                      {STATUS_LABEL[risk.status] ?? risk.status}
                    </span>
                    {canManage && (
                      <Actions
                        label={risk.statement}
                        onEdit={() => setEditor({ entity: 'risks', record: risk })}
                        onArchive={() => archive('risks', risk.id, risk.statement)}
                        busy={archiving === risk.id}
                      />
                    )}
                  </div>
                  {goalStatement(risk.goalId) && (
                    <p className="text-xs text-white/40 mt-1">
                      Threatens: {goalStatement(risk.goalId)}
                    </p>
                  )}
                  {risk.mitigation && (
                    <p className="text-sm text-white/70 mt-2">{risk.mitigation}</p>
                  )}
                  <p className="text-xs text-white/40 mt-1">
                    Owner: {personName(risk.ownerPersonId)}
                  </p>
                </li>
              ))}
              {records.risks.length === 0 && (
                <li className="text-sm text-white/30">No risks recorded.</li>
              )}
            </ul>
          </Section>
        </div>
      </ProductDataState>

      {editor && (
        <StrategyRecordForm
          open
          entity={editor.entity}
          editing={editor.record}
          people={people}
          goals={records.goals}
          onClose={() => setEditor(null)}
          onSubmit={save}
        />
      )}
    </div>
  );
}
