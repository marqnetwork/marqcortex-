/**
 * RECORDING A GOAL, A DECISION OR A RISK.
 *
 * Three record types with different fields and one set of behaviours, exactly
 * as `OrganizationRecordForm` does for the spine. The two are deliberately not
 * one generic form: the fields that matter here are the ones the canon names —
 * a decision's ALTERNATIVES and RATIONALE, a risk's LIKELIHOOD, IMPACT and
 * TOLERANCE — and a form driven by a schema would render them as a list of
 * inputs rather than as the shape of the thing being recorded.
 *
 * The server's own message is shown verbatim when a write fails, because the
 * three likeliest failures are all things the operator can act on: a refusal,
 * a date in the wrong format, and a decision marked "decided" with nobody
 * behind it. The last is ONT 14.8's "traceable" as a CHECK constraint, and the
 * server turns it into a sentence before it gets here.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/cortex';
import type {
  StrategyDecision, StrategyEntityPath, StrategyGoal, StrategyRisk,
} from '@/app/lib/api';

export type StrategyRecord = StrategyGoal | StrategyDecision | StrategyRisk;

export interface StrategyRecordFormProps {
  open: boolean;
  entity: StrategyEntityPath;
  editing: StrategyRecord | null;
  people: { id: string; fullName: string }[];
  goals: StrategyGoal[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

const ENTITY_LABEL: Record<StrategyEntityPath, string> = {
  goals: 'goal', decisions: 'decision', risks: 'risk',
};

const FIELD_CLASS =
  'w-full rounded-cortex-md bg-cortex-control border border-cortex-default px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cortex-accent focus:outline-none';

function Field({ label, htmlFor, hint, children }: {
  label: string; htmlFor: string; hint?: string; children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-white/60">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-white/35">{hint}</p>}
    </div>
  );
}

function Select({ id, label, value, onChange, options, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={FIELD_CLASS}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function value(record: StrategyRecord | null, key: string): string {
  if (!record) return '';
  const v = (record as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

const GOAL_STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'under_review', label: 'Under review' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DECISION_STATUSES = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'decided', label: 'Decided' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RISK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'mitigating', label: 'Mitigating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
];

const LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const TOLERANCES = [
  { value: 'unset', label: 'Not yet assessed' },
  { value: 'within', label: 'Within tolerance' },
  { value: 'outside', label: 'Outside tolerance' },
];

export function StrategyRecordForm({
  open, entity, editing, people, goals, onClose, onSubmit,
}: StrategyRecordFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setValues({
      statement: value(editing, 'statement'),
      measure: value(editing, 'measure'),
      targetValue: value(editing, 'targetValue'),
      currentValue: value(editing, 'currentValue'),
      dueOn: value(editing, 'dueOn'),
      ownerPersonId: value(editing, 'ownerPersonId'),
      alternatives: value(editing, 'alternatives'),
      rationale: value(editing, 'rationale'),
      goalId: value(editing, 'goalId'),
      decidedByPersonId: value(editing, 'decidedByPersonId'),
      decidedOn: value(editing, 'decidedOn'),
      reviewOn: value(editing, 'reviewOn'),
      mitigation: value(editing, 'mitigation'),
      likelihood: value(editing, 'likelihood') || 'medium',
      impact: value(editing, 'impact') || 'medium',
      tolerance: value(editing, 'tolerance') || 'unset',
      status: value(editing, 'status')
        || (entity === 'goals' ? 'planned' : entity === 'decisions' ? 'proposed' : 'open'),
    });
  }, [open, editing, entity]);

  const set = (key: string) => (next: string) => setValues(v => ({ ...v, [key]: next }));
  // `null` where the operator chose nothing, so the server CLEARS the column.
  // An empty string is dropped as "not supplied", and the link would never come off.
  const ref = (key: string) => (values[key] === '' ? null : values[key]);

  function payload(): Record<string, unknown> {
    switch (entity) {
      case 'goals':
        return {
          statement: values.statement, measure: values.measure,
          targetValue: values.targetValue, currentValue: values.currentValue,
          dueOn: ref('dueOn'), ownerPersonId: ref('ownerPersonId'), status: values.status,
        };
      case 'decisions':
        return {
          statement: values.statement, alternatives: values.alternatives,
          rationale: values.rationale, goalId: ref('goalId'),
          decidedByPersonId: ref('decidedByPersonId'), decidedOn: ref('decidedOn'),
          reviewOn: ref('reviewOn'), status: values.status,
        };
      case 'risks':
        return {
          statement: values.statement, likelihood: values.likelihood, impact: values.impact,
          tolerance: values.tolerance, mitigation: values.mitigation,
          goalId: ref('goalId'), ownerPersonId: ref('ownerPersonId'), status: values.status,
        };
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(payload());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved.');
      setSaving(false);
    }
  }

  const label = ENTITY_LABEL[entity];
  const personOptions = [
    { value: '', label: 'Nobody' },
    ...people.map(p => ({ value: p.id, label: p.fullName })),
  ];
  const goalOptions = [
    { value: '', label: 'No goal' },
    ...goals.map(g => ({ value: g.id, label: g.statement })),
  ];

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={editing ? `Edit ${label}` : `Record a ${label}`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={saving}
            className="px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit" form="strategy-record-form" disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-cortex-md bg-cortex-accent text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {editing ? 'Save changes' : `Record ${label}`}
          </button>
        </div>
      }
    >
      <form id="strategy-record-form" onSubmit={submit} className="space-y-4">
        <Field
          label={entity === 'risks' ? 'What could go wrong' : 'Statement'}
          htmlFor="strategy-statement"
          hint={entity === 'goals' ? 'A measurable target, e.g. "Acquire 500 customers".' : undefined}
        >
          <input
            id="strategy-statement" required value={values.statement ?? ''}
            onChange={e => set('statement')(e.target.value)} className={FIELD_CLASS}
          />
        </Field>

        {entity === 'goals' && (
          <>
            <Field
              label="Measure" htmlFor="strategy-measure"
              hint="How progress is judged. ONT 13.4: a goal is measurable."
            >
              <input
                id="strategy-measure" value={values.measure ?? ''}
                onChange={e => set('measure')(e.target.value)} className={FIELD_CLASS}
                placeholder="New customers acquired"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target" htmlFor="strategy-target">
                <input
                  id="strategy-target" value={values.targetValue ?? ''}
                  onChange={e => set('targetValue')(e.target.value)} className={FIELD_CLASS}
                  placeholder="500"
                />
              </Field>
              <Field label="Current" htmlFor="strategy-current">
                <input
                  id="strategy-current" value={values.currentValue ?? ''}
                  onChange={e => set('currentValue')(e.target.value)} className={FIELD_CLASS}
                  placeholder="180"
                />
              </Field>
            </div>
            <Field label="Due" htmlFor="strategy-due" hint="Optional — not every goal is dated.">
              <input
                id="strategy-due" type="date" value={values.dueOn ?? ''}
                onChange={e => set('dueOn')(e.target.value)} className={FIELD_CLASS}
              />
            </Field>
            <Select
              id="strategy-owner" label="Owner" value={values.ownerPersonId ?? ''}
              onChange={set('ownerPersonId')} options={personOptions}
              hint="A person in the organization. They do not need a console login."
            />
            <Select
              id="strategy-status" label="Status" value={values.status ?? 'planned'}
              onChange={set('status')} options={GOAL_STATUSES}
            />
          </>
        )}

        {entity === 'decisions' && (
          <>
            <Field
              label="Alternatives considered" htmlFor="strategy-alternatives"
              hint="ONT 14.8: a decision is a selection AMONG alternatives."
            >
              <input
                id="strategy-alternatives" value={values.alternatives ?? ''}
                onChange={e => set('alternatives')(e.target.value)} className={FIELD_CLASS}
                placeholder="Build in house; buy; do nothing"
              />
            </Field>
            <Field
              label="Rationale" htmlFor="strategy-rationale"
              hint="Why this one. A decision with no rationale is flagged on the surface."
            >
              <textarea
                id="strategy-rationale" rows={3} value={values.rationale ?? ''}
                onChange={e => set('rationale')(e.target.value)} className={FIELD_CLASS}
              />
            </Field>
            <Select
              id="strategy-goal" label="Serves which goal" value={values.goalId ?? ''}
              onChange={set('goalId')} options={goalOptions}
            />
            <Select
              id="strategy-decider" label="Decided by" value={values.decidedByPersonId ?? ''}
              onChange={set('decidedByPersonId')} options={personOptions}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Decided on" htmlFor="strategy-decided-on">
                <input
                  id="strategy-decided-on" type="date" value={values.decidedOn ?? ''}
                  onChange={e => set('decidedOn')(e.target.value)} className={FIELD_CLASS}
                />
              </Field>
              <Field label="Review on" htmlFor="strategy-review-on">
                <input
                  id="strategy-review-on" type="date" value={values.reviewOn ?? ''}
                  onChange={e => set('reviewOn')(e.target.value)} className={FIELD_CLASS}
                />
              </Field>
            </div>
            <Select
              id="strategy-status" label="Status" value={values.status ?? 'proposed'}
              onChange={set('status')} options={DECISION_STATUSES}
              hint="A decision marked Decided needs a decider and a date."
            />
          </>
        )}

        {entity === 'risks' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Select
                id="strategy-likelihood" label="Likelihood" value={values.likelihood ?? 'medium'}
                onChange={set('likelihood')} options={LEVELS}
              />
              <Select
                id="strategy-impact" label="Impact" value={values.impact ?? 'medium'}
                onChange={set('impact')} options={LEVELS}
              />
            </div>
            <Select
              id="strategy-tolerance" label="Organizational tolerance"
              value={values.tolerance ?? 'unset'} onChange={set('tolerance')} options={TOLERANCES}
              hint="A risk can only be Accepted once its tolerance has been decided."
            />
            <Field label="Mitigation" htmlFor="strategy-mitigation">
              <textarea
                id="strategy-mitigation" rows={2} value={values.mitigation ?? ''}
                onChange={e => set('mitigation')(e.target.value)} className={FIELD_CLASS}
              />
            </Field>
            <Select
              id="strategy-goal" label="Threatens which goal" value={values.goalId ?? ''}
              onChange={set('goalId')} options={goalOptions}
            />
            <Select
              id="strategy-owner" label="Owner" value={values.ownerPersonId ?? ''}
              onChange={set('ownerPersonId')} options={personOptions}
            />
            <Select
              id="strategy-status" label="Status" value={values.status ?? 'open'}
              onChange={set('status')} options={RISK_STATUSES}
            />
          </>
        )}

        {error && (
          <p
            role="alert" data-testid="strategy-form-error"
            className="text-sm text-cortex-danger bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md px-3 py-2"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
