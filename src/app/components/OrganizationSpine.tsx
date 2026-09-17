/**
 * THE ORGANIZATIONAL SPINE — the first surface that shows the organization
 * itself rather than the list of people who can sign in.
 *
 * WHY THIS IS NOT THE ROSTER BELOW IT
 *
 * `TeamManagement`'s member list answers "who has console credentials". That
 * is an authentication question. This answers an organizational one: who
 * belongs, in which department, under whom, on which team, inside which
 * business unit. ONT 12.3 settles that they are different questions — "Not
 * every Identity is necessarily an active User" — so a contractor with a
 * department, a reporting line and a team membership but no password is a full
 * member of this organization and appears on exactly one of the two lists.
 *
 * The surface says so out loud rather than leaving it to be discovered: people
 * without console access are labelled, and the count is on the summary. An
 * organization where that number is a surprise is one whose records are wrong,
 * and the fastest way to find that out is to print it.
 *
 * WRITABLE IN CP-4, AND ONLY FOR THOSE WHO MAY.
 *
 * CP-3 built the spine and showed it, which left it permanently empty against
 * a live project — a capability whose data path did not exist. The controls
 * are here now, and they appear ONLY when the server reports that this account
 * holds `organization.structure.manage`. That flag decides what is OFFERED and
 * nothing else: every write runs under the caller's own JWT and is authorized
 * by the RLS policies on the spine tables, so a viewer who reached these
 * controls some other way would be refused by PostgreSQL, not by this file.
 *
 * CP-2's rule still governs what may be shown: a control that cannot do its
 * job must not be offered. So a viewer sees no buttons at all rather than
 * disabled ones — a disabled button is a promise that signing in differently
 * would help, and for a viewer it is the truth, while for somebody whose
 * membership is suspended it is not.
 *
 * THE FIVE STATES ARE NOT OPTIONAL. Loading, real data, empty, error and
 * permission-denied all come from `ProductDataState`, so this surface cannot
 * answer a failure with a plausible-looking blank organization.
 */

import { useCallback, useMemo, useState } from 'react';
import { Archive, Building2, GitBranch, KeyRound, Pencil, Plus, Users2, UserRound } from 'lucide-react';
import {
  archiveOrganizationRecord,
  createOrganizationRecord,
  getOrganizationStructure,
  updateOrganizationRecord,
} from '@/app/services/dataService';
import { OrganizationRecordForm, type SpineRecord } from '@/app/components/OrganizationRecordForm';
import { useProductData } from '@/app/hooks/useProductData';
import { ProductDataState } from '@/app/components/ProductDataState';
import type {
  OrganizationDepartment,
  OrganizationPerson,
  OrganizationStructureResponse,
  OrganizationTeam,
  SpineEntityPath,
} from '@/app/lib/api';

interface Props {
  accessToken?: string;
}

const EMPTY_STRUCTURE: OrganizationStructureResponse['structure'] = {
  businessUnits: [], departments: [], people: [], teams: [], teamMemberships: [],
};

/**
 * What can be added, in the order an organization is actually built.
 *
 * People first because they are the only one the others REFER to: a department
 * with no candidate lead and a team with nobody on it are the shapes an
 * operator gets if they start at the top, and both need a second pass.
 */
const ADDABLE: { entity: SpineEntityPath; label: string }[] = [
  { entity: 'people', label: 'Add person' },
  { entity: 'departments', label: 'Add department' },
  { entity: 'teams', label: 'Add team' },
  { entity: 'business-units', label: 'Add business unit' },
];

/**
 * "Nothing yet" for this surface means no PEOPLE.
 *
 * The default emptiness test would look at the response wrapper, which always
 * has a `success` key and is therefore never empty. An organization can also
 * legitimately have people and no departments — that is a partially recorded
 * organization, not an empty one, and it renders as real data with the gaps
 * visible.
 */
function hasNothingRecorded(response: OrganizationStructureResponse): boolean {
  const s = response?.structure;
  if (!s) return true;
  return s.people.length === 0 && s.departments.length === 0
    && s.teams.length === 0 && s.businessUnits.length === 0;
}

function Tile({ icon: Icon, value, label, hint }: {
  icon: typeof Users2; value: number; label: string; hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-cortex-md border border-cortex-default bg-cortex-raised px-4 py-3"
      title={hint}
    >
      <Icon className="size-5 text-cortex-accent shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xl font-black text-white leading-none">{value}</p>
        <p className="text-xs text-white/50 mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

/**
 * Edit and archive for one row.
 *
 * Rendered only when `onEdit` is supplied, which the caller does only when the
 * server reported manage authority — so a viewer gets a row with no controls
 * rather than a row with dead ones.
 */
function RowActions({ label, onEdit, onArchive, busy }: {
  label: string; onEdit: () => void; onArchive: () => void; busy?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
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

function PersonLine({
  person, departmentName, managerName, onEdit, onArchive, archiving,
}: {
  person: OrganizationPerson; departmentName: string; managerName: string;
  onEdit?: () => void; onArchive?: () => void; archiving?: boolean;
}) {
  return (
    <li
      data-testid="spine-person"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-cortex-default last:border-b-0"
    >
      <span className="font-medium text-white">{person.fullName}</span>
      {person.positionTitle && (
        <span className="text-xs text-white/50">{person.positionTitle}</span>
      )}
      <span className="text-xs text-white/40">{departmentName}</span>
      <span className="text-xs text-white/40">Reports to: {managerName}</span>
      {person.status !== 'active' && (
        <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border border-cortex-warning/30 text-cortex-warning bg-cortex-warning/10">
          {person.status}
        </span>
      )}
      {/* A person without a login is NORMAL, not broken — see the header note.
          Labelled so the roster below can never be mistaken for this one. */}
      <span
        data-console-access={person.hasConsoleAccess ? 'yes' : 'no'}
        title={person.hasConsoleAccess
          ? 'This person can sign into the console.'
          : 'This person belongs to the organization but has no console login.'}
        className={person.hasConsoleAccess
          ? 'ml-auto text-[11px] inline-flex items-center gap-1 text-cortex-success'
          : 'ml-auto text-[11px] inline-flex items-center gap-1 text-white/40'}
      >
        <KeyRound className="size-3" aria-hidden="true" />
        {person.hasConsoleAccess ? 'Console access' : 'No console login'}
      </span>
      {onEdit && onArchive && (
        <RowActions
          label={person.fullName} onEdit={onEdit} onArchive={onArchive} busy={archiving}
        />
      )}
    </li>
  );
}

export function OrganizationSpine({ accessToken }: Props) {
  const spine = useProductData<OrganizationStructureResponse>(
    () => getOrganizationStructure(accessToken || '') as Promise<OrganizationStructureResponse>,
    [accessToken],
    { skip: !accessToken, isEmpty: hasNothingRecorded },
  );

  const structure = spine.data?.structure ?? EMPTY_STRUCTURE;
  const summary = spine.data?.summary;
  const organization = spine.data?.organization ?? null;
  // Absent reads as FALSE. A backend that did not report the flag has not told
  // us the operator may write, and offering controls on a maybe is how a
  // dead-end button gets shipped.
  const canManage = spine.data?.canManageStructure === true;

  const [editor, setEditor] = useState<
    { entity: SpineEntityPath; record: SpineRecord | null } | null
  >(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const save = useCallback(async (payload: Record<string, unknown>) => {
    if (!editor || !accessToken) return;
    if (editor.record) {
      await updateOrganizationRecord(editor.entity, editor.record.id, payload, accessToken);
    } else {
      await createOrganizationRecord(editor.entity, payload, accessToken);
    }
    // Close first, then re-read. The list must come from the SERVER rather than
    // from the record the write returned: a create can change more than the row
    // it made — a new lead appears on a department, a reporting line moves —
    // and patching one row into local state would show an organization that is
    // nearly right, which is the worst of the three options.
    setEditor(null);
    spine.reload();
  }, [editor, accessToken, spine]);

  const archive = useCallback(async (entity: SpineEntityPath, record: SpineRecord, name: string) => {
    if (!accessToken) return;
    // A confirm, because archiving is the only destructive control here and it
    // is one click away from an edit button.
    if (!window.confirm(`Archive ${name}? It stops appearing in the organization.`)) return;
    setArchiving(record.id);
    setActionError(null);
    try {
      await archiveOrganizationRecord(entity, record.id, accessToken);
      spine.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That record could not be archived.');
    } finally {
      setArchiving(null);
    }
  }, [accessToken, spine]);

  // Names, resolved once. An unresolved reference renders as an em dash rather
  // than as a blank or an id: a department that was deleted out from under a
  // person is a fact worth seeing, and a silent gap hides it.
  const peopleById = useMemo(
    () => new Map(structure.people.map((p) => [p.id, p])),
    [structure.people],
  );
  const departmentsById = useMemo(
    () => new Map(structure.departments.map((d) => [d.id, d])),
    [structure.departments],
  );
  const membersByTeam = useMemo(() => {
    const map = new Map<string, OrganizationPerson[]>();
    for (const membership of structure.teamMemberships) {
      const person = peopleById.get(membership.personId);
      if (!person) continue;
      const list = map.get(membership.teamId) ?? [];
      list.push(person);
      map.set(membership.teamId, list);
    }
    return map;
  }, [structure.teamMemberships, peopleById]);

  const departmentName = (id: string | null) =>
    id === null ? 'No department' : departmentsById.get(id)?.name ?? '—';
  const personName = (id: string | null) =>
    id === null ? '—' : peopleById.get(id)?.fullName ?? '—';

  const rowActions: RowActionSet | null = canManage
    ? {
        edit: (entity, record) => setEditor({ entity, record }),
        archive: (entity, record, name) => { void archive(entity, record, name); },
        busyId: archiving,
      }
    : null;

  const departmentsByUnit = (unitId: string | null): OrganizationDepartment[] =>
    structure.departments.filter((d) => d.businessUnitId === unitId);
  const teamsOfDepartment = (departmentId: string): OrganizationTeam[] =>
    structure.teams.filter((t) => t.departmentId === departmentId);
  const unparentedDepartments = departmentsByUnit(null);
  const unparentedTeams = structure.teams.filter((t) => t.departmentId === null);

  return (
    <section data-testid="organization-spine" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-black text-white mb-1">
            Organization{organization ? ` — ${organization.organizationName}` : ''}
          </h2>
          <p className="text-white/50 text-sm">
            Who belongs to this organization, where they sit and who they report to.
            Not everyone here has a console login — those who do are listed separately below.
          </p>
        </div>
        {/* Offered only to an account the server says holds
            `organization.structure.manage`. A viewer sees nothing here rather
            than disabled buttons — see the header note on why. */}
        {canManage && !spine.loading && spine.reason === null && (
          <div className="flex flex-wrap gap-2" data-testid="spine-actions">
            {ADDABLE.map(({ entity, label }) => (
              <button
                key={entity}
                type="button"
                onClick={() => setEditor({ entity, record: null })}
                data-testid={`spine-add-${entity}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-cortex-md bg-cortex-raised border border-cortex-default text-white/80 hover:text-white hover:border-cortex-strong transition-colors"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {actionError && (
        <p
          role="alert"
          data-testid="spine-action-error"
          className="text-sm text-cortex-danger bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md px-3 py-2"
        >
          {actionError}
        </p>
      )}

      <ProductDataState
        loading={spine.loading}
        reason={spine.reason}
        detail={spine.detail}
        empty={spine.isEmpty}
        subject="organizational structure"
        emptyHint="No people, departments or teams have been recorded for this organization yet."
        onRetry={spine.reload}
      >
        <div className="space-y-6">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="spine-summary">
              <Tile icon={UserRound} value={summary.people} label="People" />
              <Tile icon={Building2} value={summary.departments} label="Departments" />
              <Tile icon={Users2} value={summary.teams} label="Teams" />
              <Tile
                icon={KeyRound}
                value={summary.peopleWithoutConsoleAccess}
                label="Without a console login"
                hint="Organizational people who cannot sign in. Expected, not an error."
              />
            </div>
          )}

          {summary && summary.unassignedPeople > 0 && (
            // Stated rather than hidden. People outside the structure are what
            // makes an org chart wrong, and they are invisible everywhere else.
            <p className="text-sm text-cortex-warning" data-testid="spine-unassigned">
              {summary.unassignedPeople} {summary.unassignedPeople === 1 ? 'person is' : 'people are'} not
              assigned to a department.
            </p>
          )}

          {/* ── Structure ── */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/40">Structure</h3>
            {structure.businessUnits.map((unit) => (
              <div key={unit.id} data-testid="spine-business-unit"
                   className="rounded-cortex-md border border-cortex-default bg-cortex-raised p-4">
                <p className="font-bold text-white flex items-center gap-2">
                  <Building2 className="size-4 text-cortex-accent" aria-hidden="true" />
                  {unit.name}
                  {canManage && (
                    <RowActions
                      label={unit.name}
                      onEdit={() => setEditor({ entity: 'business-units', record: unit })}
                      onArchive={() => archive('business-units', unit, unit.name)}
                      busy={archiving === unit.id}
                    />
                  )}
                </p>
                {unit.description && <p className="text-xs text-white/40 mt-1">{unit.description}</p>}
                <DepartmentList
                  departments={departmentsByUnit(unit.id)}
                  teamsOfDepartment={teamsOfDepartment}
                  personName={personName}
                  membersByTeam={membersByTeam}
                  actions={rowActions}
                />
              </div>
            ))}

            {unparentedDepartments.length > 0 && (
              <div className="rounded-cortex-md border border-cortex-default bg-cortex-raised p-4">
                <p className="font-bold text-white/70 flex items-center gap-2">
                  <Building2 className="size-4 text-white/30" aria-hidden="true" />
                  No business unit
                </p>
                <DepartmentList
                  departments={unparentedDepartments}
                  teamsOfDepartment={teamsOfDepartment}
                  personName={personName}
                  membersByTeam={membersByTeam}
                  actions={rowActions}
                />
              </div>
            )}

            {unparentedTeams.length > 0 && (
              <div className="rounded-cortex-md border border-cortex-default bg-cortex-raised p-4">
                <p className="font-bold text-white/70 flex items-center gap-2">
                  <Users2 className="size-4 text-white/30" aria-hidden="true" />
                  Teams with no department
                </p>
                <ul className="mt-2 space-y-1">
                  {unparentedTeams.map((team) => (
                    <li key={team.id} data-testid="spine-team" className="text-sm text-white/70">
                      {team.name}
                      <span className="text-xs text-white/40">
                        {' '}· {(membersByTeam.get(team.id) ?? []).length} member(s)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ── People ── */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white/40 mb-2">
              People ({structure.people.length})
            </h3>
            <ul className="rounded-cortex-md border border-cortex-default bg-cortex-raised overflow-hidden">
              {structure.people.map((person) => (
                <PersonLine
                  key={person.id}
                  person={person}
                  departmentName={departmentName(person.departmentId)}
                  managerName={personName(person.reportsToPersonId)}
                  onEdit={canManage ? () => setEditor({ entity: 'people', record: person }) : undefined}
                  onArchive={() => archive('people', person, person.fullName)}
                  archiving={archiving === person.id}
                />
              ))}
            </ul>
          </div>
        </div>
      </ProductDataState>

      {editor && (
        <OrganizationRecordForm
          open
          entity={editor.entity}
          editing={editor.record}
          people={structure.people}
          departments={structure.departments}
          businessUnits={structure.businessUnits}
          onClose={() => setEditor(null)}
          onSubmit={save}
        />
      )}
    </section>
  );
}

/** What a row may do, or `null` when this account may do nothing. */
interface RowActionSet {
  edit: (entity: SpineEntityPath, record: SpineRecord) => void;
  archive: (entity: SpineEntityPath, record: SpineRecord, name: string) => void;
  busyId: string | null;
}

function DepartmentList({
  departments, teamsOfDepartment, personName, membersByTeam, actions,
}: {
  departments: OrganizationDepartment[];
  teamsOfDepartment: (id: string) => OrganizationTeam[];
  personName: (id: string | null) => string;
  membersByTeam: Map<string, OrganizationPerson[]>;
  actions: RowActionSet | null;
}) {
  if (departments.length === 0) {
    return <p className="text-xs text-white/30 mt-2">No departments recorded.</p>;
  }
  return (
    <ul className="mt-3 space-y-3">
      {departments.map((department) => (
        <li key={department.id} data-testid="spine-department" className="pl-4 border-l border-cortex-default">
          <p className="text-sm font-medium text-white flex items-center gap-2">
            <GitBranch className="size-3.5 text-white/30" aria-hidden="true" />
            {department.name}
            <span className="text-xs text-white/40">
              Lead: {personName(department.leadPersonId)}
            </span>
            {actions && (
              <RowActions
                label={department.name}
                onEdit={() => actions.edit('departments', department)}
                onArchive={() => actions.archive('departments', department, department.name)}
                busy={actions.busyId === department.id}
              />
            )}
          </p>
          <ul className="mt-1 space-y-0.5">
            {teamsOfDepartment(department.id).map((team) => (
              <li key={team.id} data-testid="spine-team" className="text-xs text-white/50 pl-5">
                {team.name} · {(membersByTeam.get(team.id) ?? []).length} member(s)
                {team.leadPersonId && <> · lead {personName(team.leadPersonId)}</>}
                {actions && (
                  <RowActions
                    label={team.name}
                    onEdit={() => actions.edit('teams', team)}
                    onArchive={() => actions.archive('teams', team, team.name)}
                    busy={actions.busyId === team.id}
                  />
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
