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
 * READ-ONLY, AND IT DOES NOT PRETEND OTHERWISE.
 *
 * CP-3 builds the spine and shows it; writing to it is CP-4's. There is no
 * disabled "Add person" button here and no menu that opens onto nothing —
 * CP-2's rule was that a control which cannot do its job must not be offered,
 * and a control offered for a capability that does not exist yet is the same
 * defect with a nicer excuse.
 *
 * THE FIVE STATES ARE NOT OPTIONAL. Loading, real data, empty, error and
 * permission-denied all come from `ProductDataState`, so this surface cannot
 * answer a failure with a plausible-looking blank organization.
 */

import { useMemo } from 'react';
import { Building2, GitBranch, KeyRound, Users2, UserRound } from 'lucide-react';
import { getOrganizationStructure } from '@/app/services/dataService';
import { useProductData } from '@/app/hooks/useProductData';
import { ProductDataState } from '@/app/components/ProductDataState';
import type {
  OrganizationDepartment,
  OrganizationPerson,
  OrganizationStructureResponse,
  OrganizationTeam,
} from '@/app/lib/api';

interface Props {
  accessToken?: string;
}

const EMPTY_STRUCTURE: OrganizationStructureResponse['structure'] = {
  businessUnits: [], departments: [], people: [], teams: [], teamMemberships: [],
};

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

function PersonLine({
  person, departmentName, managerName,
}: { person: OrganizationPerson; departmentName: string; managerName: string }) {
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

  const departmentsByUnit = (unitId: string | null): OrganizationDepartment[] =>
    structure.departments.filter((d) => d.businessUnitId === unitId);
  const teamsOfDepartment = (departmentId: string): OrganizationTeam[] =>
    structure.teams.filter((t) => t.departmentId === departmentId);
  const unparentedDepartments = departmentsByUnit(null);
  const unparentedTeams = structure.teams.filter((t) => t.departmentId === null);

  return (
    <section data-testid="organization-spine" className="space-y-4">
      <header>
        <h2 className="text-2xl font-black text-white mb-1">
          Organization{organization ? ` — ${organization.organizationName}` : ''}
        </h2>
        <p className="text-white/50 text-sm">
          Who belongs to this organization, where they sit and who they report to.
          Not everyone here has a console login — those who do are listed separately below.
        </p>
      </header>

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
                </p>
                {unit.description && <p className="text-xs text-white/40 mt-1">{unit.description}</p>}
                <DepartmentList
                  departments={departmentsByUnit(unit.id)}
                  teamsOfDepartment={teamsOfDepartment}
                  personName={personName}
                  membersByTeam={membersByTeam}
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
                />
              ))}
            </ul>
          </div>
        </div>
      </ProductDataState>
    </section>
  );
}

function DepartmentList({
  departments, teamsOfDepartment, personName, membersByTeam,
}: {
  departments: OrganizationDepartment[];
  teamsOfDepartment: (id: string) => OrganizationTeam[];
  personName: (id: string | null) => string;
  membersByTeam: Map<string, OrganizationPerson[]>;
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
          </p>
          <ul className="mt-1 space-y-0.5">
            {teamsOfDepartment(department.id).map((team) => (
              <li key={team.id} data-testid="spine-team" className="text-xs text-white/50 pl-5">
                {team.name} · {(membersByTeam.get(team.id) ?? []).length} member(s)
                {team.leadPersonId && <> · lead {personName(team.leadPersonId)}</>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
