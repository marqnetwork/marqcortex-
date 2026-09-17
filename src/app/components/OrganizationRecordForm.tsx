/**
 * THE ONE FORM THE ORGANIZATION IS EDITED THROUGH.
 *
 * Four record types — business unit, department, team, person — with different
 * fields and one set of behaviours: a dialog, a submit that can fail, an error
 * that is the SERVER'S and not a generic one, and a busy state that stops a
 * double submit creating two people.
 *
 * WHY THE SERVER'S MESSAGE IS SHOWN VERBATIM
 *
 * `organizationWrites.ts` classifies every failure into one of five, and the
 * message it produces is written to be read by an operator: "Your account
 * cannot change this organization's structure", "Something with that key or
 * email already exists". Replacing those with "Something went wrong" would
 * throw away the only part of the response that tells somebody what to do —
 * and the three most likely failures here (a refusal, a duplicate, a reference
 * to a department in another tenant) are all things the operator can act on.
 *
 * WHAT THIS FORM CANNOT SET
 *
 * There is no field for `organization_id` and none for `user_id`. The first is
 * written by the server from the resolved workspace; the second is console
 * access, which is a different permission granted on a different surface. Their
 * absence is deliberate — see the allow-lists in `organizationWrites.ts`.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/cortex';
import type {
  OrganizationBusinessUnit,
  OrganizationDepartment,
  OrganizationPerson,
  OrganizationTeam,
  SpineEntityPath,
} from '@/app/lib/api';

export type SpineRecord =
  | OrganizationBusinessUnit
  | OrganizationDepartment
  | OrganizationTeam
  | OrganizationPerson;

export interface OrganizationRecordFormProps {
  open: boolean;
  entity: SpineEntityPath;
  /** The record being edited, or `null` when creating a new one. */
  editing: SpineRecord | null;
  /** Options for the reference fields, so a lead is chosen and never typed. */
  people: OrganizationPerson[];
  departments: OrganizationDepartment[];
  businessUnits: OrganizationBusinessUnit[];
  onClose: () => void;
  /** Resolve to close the dialog; reject with an Error whose message is shown. */
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

const ENTITY_LABEL: Record<SpineEntityPath, string> = {
  'business-units': 'business unit',
  departments: 'department',
  teams: 'team',
  people: 'person',
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

/**
 * A reference picker.
 *
 * Always includes an explicit "None" — clearing a reporting line or moving a
 * team out of a department has to be possible, and a select with no empty
 * option makes the first choice permanent. The empty value maps to `null`,
 * which `organizationWrites` writes rather than skips.
 */
function Reference({ id, label, value, onChange, options, noneLabel }: {
  id: string; label: string; value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
  noneLabel: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={FIELD_CLASS}>
        <option value="">{noneLabel}</option>
        {options.map(option => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

/** Read a field off whichever record shape this is, without a cast at each site. */
function field(record: SpineRecord | null, key: string): string {
  if (!record) return '';
  const value = (record as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function OrganizationRecordForm({
  open, entity, editing, people, departments, businessUnits, onClose, onSubmit,
}: OrganizationRecordFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens, or when it is reused for a different record.
  // Without this, opening "edit Dana" after "edit Ravi" would show Ravi's
  // values over Dana's id — an edit form that silently writes the wrong thing.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setValues({
      name: field(editing, 'name'),
      description: field(editing, 'description'),
      fullName: field(editing, 'fullName'),
      email: field(editing, 'email'),
      positionTitle: field(editing, 'positionTitle'),
      status: field(editing, 'status') || 'active',
      departmentId: field(editing, 'departmentId'),
      businessUnitId: field(editing, 'businessUnitId'),
      leadPersonId: field(editing, 'leadPersonId'),
      reportsToPersonId: field(editing, 'reportsToPersonId'),
    });
  }, [open, editing, entity]);

  const set = (key: string) => (next: string) => setValues(v => ({ ...v, [key]: next }));

  function payload(): Record<string, unknown> {
    // `null` where the operator chose "None", so the server CLEARS the column
    // rather than leaving it. An empty string would be dropped as "not
    // supplied", and the reporting line would never come off.
    const reference = (key: string) => (values[key] === '' ? null : values[key]);
    switch (entity) {
      case 'business-units':
        return { name: values.name, description: values.description };
      case 'departments':
        return {
          name: values.name, description: values.description,
          businessUnitId: reference('businessUnitId'),
          leadPersonId: reference('leadPersonId'),
        };
      case 'teams':
        return {
          name: values.name, description: values.description,
          departmentId: reference('departmentId'),
          leadPersonId: reference('leadPersonId'),
        };
      case 'people':
        return {
          fullName: values.fullName, email: values.email,
          positionTitle: values.positionTitle, status: values.status,
          departmentId: reference('departmentId'),
          reportsToPersonId: reference('reportsToPersonId'),
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
      // The server's own words. See the header note.
      setError(err instanceof Error ? err.message : 'The change could not be saved.');
      setSaving(false);
    }
  }

  const label = ENTITY_LABEL[entity];
  const personOptions = people.map(p => ({ id: p.id, label: p.fullName }));
  // A person cannot report to themselves — the database refuses it, and
  // offering the option would be a control whose only outcome is an error.
  const managerOptions = personOptions.filter(p => p.id !== (editing as OrganizationPerson | null)?.id);

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={editing ? `Edit ${label}` : `Add ${label}`}
      description={
        entity === 'people'
          ? 'A person belongs to the organization. Adding one here does not create a console login.'
          : undefined
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button" onClick={onClose} disabled={saving}
            className="px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit" form="organization-record-form" disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-cortex-md bg-cortex-accent text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {editing ? 'Save changes' : `Add ${label}`}
          </button>
        </div>
      }
    >
      <form id="organization-record-form" onSubmit={submit} className="space-y-4">
        {entity === 'people' ? (
          <>
            <Field label="Full name" htmlFor="org-full-name">
              <input
                id="org-full-name" required value={values.fullName ?? ''}
                onChange={e => set('fullName')(e.target.value)}
                className={FIELD_CLASS} placeholder="Ada Okafor"
              />
            </Field>
            <Field
              label="Email" htmlFor="org-email"
              hint="Optional. This is how to reach them, not a login."
            >
              <input
                id="org-email" type="email" value={values.email ?? ''}
                onChange={e => set('email')(e.target.value)}
                className={FIELD_CLASS} placeholder="ada@example.com"
              />
            </Field>
            <Field label="Position" htmlFor="org-position">
              <input
                id="org-position" value={values.positionTitle ?? ''}
                onChange={e => set('positionTitle')(e.target.value)}
                className={FIELD_CLASS} placeholder="Senior Engineer"
              />
            </Field>
            <Field label="Status" htmlFor="org-status">
              <select
                id="org-status" value={values.status ?? 'active'}
                onChange={e => set('status')(e.target.value)} className={FIELD_CLASS}
              >
                <option value="active">Active</option>
                <option value="invited">Invited</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Reference
              id="org-person-department" label="Department"
              value={values.departmentId ?? ''} onChange={set('departmentId')}
              options={departments.map(d => ({ id: d.id, label: d.name }))}
              noneLabel="No department"
            />
            <Reference
              id="org-reports-to" label="Reports to"
              value={values.reportsToPersonId ?? ''} onChange={set('reportsToPersonId')}
              options={managerOptions} noneLabel="Nobody"
            />
          </>
        ) : (
          <>
            <Field
              label="Name" htmlFor="org-name"
              hint="A short key is derived from this automatically."
            >
              <input
                id="org-name" required value={values.name ?? ''}
                onChange={e => set('name')(e.target.value)}
                className={FIELD_CLASS} placeholder="Client Services"
              />
            </Field>
            <Field label="Description" htmlFor="org-description">
              <input
                id="org-description" value={values.description ?? ''}
                onChange={e => set('description')(e.target.value)}
                className={FIELD_CLASS} placeholder="What this part of the organization does"
              />
            </Field>
            {entity === 'departments' && (
              <Reference
                id="org-business-unit" label="Business unit"
                value={values.businessUnitId ?? ''} onChange={set('businessUnitId')}
                options={businessUnits.map(u => ({ id: u.id, label: u.name }))}
                noneLabel="No business unit"
              />
            )}
            {entity === 'teams' && (
              <Reference
                id="org-team-department" label="Department"
                value={values.departmentId ?? ''} onChange={set('departmentId')}
                options={departments.map(d => ({ id: d.id, label: d.name }))}
                noneLabel="No department"
              />
            )}
            {(entity === 'departments' || entity === 'teams') && (
              <Reference
                id="org-lead" label="Lead"
                value={values.leadPersonId ?? ''} onChange={set('leadPersonId')}
                options={personOptions} noneLabel="No lead"
              />
            )}
          </>
        )}

        {error && (
          <p
            role="alert" data-testid="organization-form-error"
            className="text-sm text-cortex-danger bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md px-3 py-2"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
