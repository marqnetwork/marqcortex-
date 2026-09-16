/**
 * NAVIGATION MODEL — the one canonical description of where a team operator can go.
 *
 * Product Experience Ch. 21 governs this module.
 *
 *   21.2  Intent before destination. Destinations are grouped by what the
 *         operator is trying to DO, not by which subsystem implements it.
 *   21.4  Multiple paths, one truth. The sidebar, the command palette and the
 *         keyboard shortcuts are three paths; they must not describe three
 *         different products. Before this module the sidebar declared eleven
 *         destinations and the command palette declared four — duplicate
 *         realities, which 21.4 names explicitly as the failure.
 *   21.5  Predictability comes from a stable hierarchy and repeated patterns.
 *   21.6  Growth adds depth, not complexity: a new destination is one entry
 *         here, and every surface picks it up.
 *  21.10  The mental model stays constant across interaction modes; only the
 *         interaction changes.
 *
 * ADDING A DESTINATION: add one entry to NAV_GROUPS. The sidebar, the command
 * palette, the shortcut table and the breadcrumb trail all follow from it. Do
 * not hand-add a destination to any single surface.
 *
 * This module holds no runtime authority. It decides nothing about what an
 * operator may DO — every surface it points at resolves the actor's role
 * server-side and renders its own unauthorized state. Nothing here is a
 * permission check, and nothing here should become one.
 */

import { isDestinationVisible } from './capabilityStatus.ts';
import {
  LayoutDashboard,
  Brain,
  BarChart3,
  TrendingUp,
  Zap,
  GitBranch,
  Shield,
  Mail,
  Users,
  Settings,
  Cpu,
  Sparkles,
  Activity,
  type LucideIcon,
} from 'lucide-react';

/**
 * The query parameter that names the current destination.
 *
 * Every in-app page used to live in `useState` under the single URL
 * `#/team/dashboard`, so no destination was linkable, bookmarkable or
 * restorable — a refresh returned the operator to the dashboard from wherever
 * they were, and browser Back left the shell entirely. Ch. 21.11 asks that
 * exploration never carry a penalty, and losing your place on refresh is one.
 *
 * `#/team/dashboard?page=control-plane` is a real address. It lives here, with
 * the rest of the navigation contract, so both the shell and the routes that
 * hand off to it read one declaration rather than restating a literal — and so
 * neither has to import the other's module to know the name.
 */
export const PAGE_PARAM = 'page';

/** Every page the team dashboard can show. */
export type DestinationId =
  | 'dashboard'
  | 'cortex'
  | 'analytics'
  | 'revenue'
  | 'execution'
  | 'mapping'
  | 'reviewer'
  | 'emails'
  | 'control-plane'
  | 'operations'
  | 'team'
  | 'settings'
  | 'architecture';

export type NavGroupId =
  | 'work'
  | 'understand'
  | 'deliver'
  | 'operate'
  | 'administer'
  | 'platform';

/**
 * How prominent a destination is on first contact.
 *
 * `primary`   — the work itself.
 * `secondary` — the work around the work.
 * `system`    — tools that describe the platform rather than the business.
 *               Ch. 13.1 names "exposing internal technical architecture in the
 *               interface" as an anti-pattern; deleting these would be worse,
 *               so a group made only of them is folded until asked for.
 *
 * Tier is presentation weight, never reachability: every destination here is
 * reachable from the sidebar, the palette and the shortcut table regardless of
 * tier. Ch. 21.8 — power users must never feel constrained.
 */
export type NavTier = 'primary' | 'secondary' | 'system';

export interface Destination {
  id: DestinationId;
  /** Sidebar label. Short, and the same word the operator would say. */
  label: string;
  /**
   * The hash route this destination lives at, when it is NOT rendered inside
   * the team-dashboard shell.
   *
   * Two destinations are like this — `execution` at `#/team/execution` and
   * `architecture` at `#/architecture` — and before CP-1 that fact was written
   * down in exactly one place: an `if (page === 'execution')` inside
   * `TeamDashboardNew.handleNavigate`. Clicking the sidebar worked, because it
   * went through that function. Everything else did not.
   *
   * `#/team/dashboard?page=execution` SILENTLY RENDERED THE DASHBOARD. The
   * shell's `pageFromParam` did not recognise the id — correctly, since the
   * shell cannot render it — and fell back, so a bookmark, a shared link, a
   * refresh or a hand-typed URL landed on the wrong screen with no error and
   * no indication. Product Reality §7.2 found it in a browser. The smoke suite
   * had been asserting `?page=execution` for months and passing, because it
   * only checked that SOMETHING rendered.
   *
   * Declared here, the shell redirects instead of falling back, the sidebar
   * reads the same field it always did, and a test can drive every destination
   * from this one list rather than a hand-kept copy that drifts.
   */
  externalRoute?: string;
  /** Command-palette subtitle — what the destination is FOR. */
  description: string;
  icon: LucideIcon;
  group: NavGroupId;
  tier: NavTier;
  /** Extra terms the palette should match on (Ch. 21.2 — search by intent). */
  keywords: string[];
  /** Digit for the Cmd/Ctrl+N accelerator, when the destination has one. */
  shortcutDigit?: number;
}

export interface NavGroup {
  id: NavGroupId;
  /** Named for the intent, not the subsystem (Ch. 21.2). */
  label: string;
  destinations: Destination[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'work',
    label: 'Work',
    destinations: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        description: "Today's submissions and priorities",
        icon: LayoutDashboard,
        group: 'work',
        tier: 'primary',
        keywords: ['home', 'submissions', 'list', 'today', 'priorities', 'queue'],
        shortcutDigit: 1,
      },
      {
        id: 'reviewer',
        label: 'Reviewer QA',
        description: 'Review and approve pending work',
        icon: Shield,
        group: 'work',
        tier: 'primary',
        keywords: ['review', 'qa', 'quality', 'approve', 'check'],
      },
      {
        id: 'emails',
        label: 'Email Queue',
        description: 'Nurture sequences waiting to send',
        icon: Mail,
        group: 'work',
        tier: 'secondary',
        keywords: ['email', 'nurture', 'queue', 'send', 'outreach'],
      },
    ],
  },
  {
    id: 'understand',
    label: 'Understand',
    destinations: [
      {
        id: 'cortex',
        label: 'CORTEX',
        description: 'Diagnostic intelligence and recommendations',
        icon: Brain,
        group: 'understand',
        tier: 'primary',
        keywords: ['ai', 'analysis', 'insights', 'diagnostic', 'recommendation'],
        shortcutDigit: 2,
      },
      {
        id: 'analytics',
        label: 'Analytics',
        description: 'Funnel and conversion performance',
        icon: BarChart3,
        group: 'understand',
        tier: 'secondary',
        keywords: ['metrics', 'charts', 'funnel', 'conversion', 'performance'],
      },
      {
        id: 'revenue',
        label: 'Revenue Intelligence',
        description: 'Pipeline value and revenue signals',
        icon: TrendingUp,
        group: 'understand',
        tier: 'secondary',
        keywords: ['revenue', 'pipeline', 'forecast', 'money', 'value', 'rev intel'],
      },
    ],
  },
  {
    id: 'deliver',
    label: 'Deliver',
    destinations: [
      {
        id: 'execution',
        label: 'Execution',
        description: 'Workstreams, milestones and delivery gates',
        icon: Zap,
        group: 'deliver',
        tier: 'primary',
        externalRoute: '/team/execution',
        keywords: ['delivery', 'project', 'milestone', 'workstream', 'gate', 'tasks'],
      },
      {
        id: 'mapping',
        label: 'Mapping Engine',
        description: 'Turn an accepted proposal into an execution plan',
        icon: GitBranch,
        group: 'deliver',
        tier: 'system',
        keywords: ['mapping', 'snapshot', 'proposal', 'plan', 'convert'],
      },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    destinations: [
      {
        // AI-01 Batches 1-4F built this console and left it reachable only at
        // Settings -> AI -> one of ten sub-tabs. Provider administration, the
        // routing console, the agent runtime and the workflow operator surface
        // were, to anyone using the running product, invisible. Ch. 20 puts
        // hierarchy in the order of importance; the platform's governance
        // surface does not belong under a preferences page.
        //
        // The Settings tab still works and still reaches the SAME component:
        // 21.4 wants many paths to one canonical entity, never a second copy.
        id: 'control-plane',
        label: 'AI Control Plane',
        description: 'Providers, routing, agents, workflows, budget and audit',
        icon: Sparkles,
        group: 'operate',
        tier: 'secondary',
        keywords: [
          'ai', 'control plane', 'provider', 'providers', 'routing', 'route',
          'agent', 'agents', 'workflow', 'workflows', 'budget', 'spend',
          'usage', 'audit', 'byok', 'model', 'llm', 'governance',
        ],
        shortcutDigit: 3,
      },
      {
        // G5 built the enterprise health roll-up (§IV-51) and the enterprise
        // KPI report (§IV-48) and shipped both with no consumer at all. This
        // is where they are read.
        id: 'operations',
        label: 'Operations',
        description: 'Enterprise health and KPI readings',
        icon: Activity,
        group: 'operate',
        tier: 'secondary',
        keywords: [
          'health', 'operations', 'operational', 'kpi', 'kpis', 'indicator',
          'indicators', 'signal', 'signals', 'status', 'uptime', 'awareness',
          'metrics', 'dimension', 'dimensions',
        ],
      },
    ],
  },
  {
    id: 'administer',
    label: 'Administer',
    destinations: [
      {
        id: 'team',
        // CP-3 renamed the LABEL and left the id alone. The destination now
        // shows the organization — people, departments, teams, reporting lines
        // — with console access as one section inside it, so "Team" had become
        // the narrower of the two things on the page. The id is the URL
        // (`?page=team`), and changing it would break every existing link for
        // a wording improvement.
        label: 'Organization',
        description: 'People, departments, teams and console access',
        icon: Users,
        group: 'administer',
        tier: 'secondary',
        keywords: [
          'members', 'people', 'permissions', 'roles', 'access', 'team',
          'organization', 'department', 'reporting line', 'org chart',
        ],
      },
      {
        id: 'settings',
        label: 'Settings',
        description: 'Profile, notifications and platform configuration',
        icon: Settings,
        group: 'administer',
        tier: 'secondary',
        keywords: ['preferences', 'config', 'configuration', 'profile', 'notifications'],
        shortcutDigit: 4,
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    destinations: [
      {
        id: 'architecture',
        label: 'Architecture',
        description: 'System architecture reference',
        icon: Cpu,
        group: 'platform',
        tier: 'system',
        externalRoute: '/architecture',
        keywords: ['architecture', 'system', 'diagram', 'reference', 'internals'],
      },
    ],
  },
] as const;

/**
 * True when a group holds nothing but system-tier destinations.
 *
 * Such a group is the one the sidebar folds until asked for. A group holding
 * any real work is never hidden behind a disclosure — progressive disclosure
 * means deferring the platform's own plumbing, not the business's work.
 *
 * Judged on VISIBLE destinations: a group whose only work-tier entry is hidden
 * is, to the person looking at it, a system group.
 */
export function isSystemGroup(group: NavGroup): boolean {
  const shown = visibleDestinationsOf(group);
  return shown.length > 0 && shown.every(destination => destination.tier === 'system');
}

/**
 * The destinations in a group that a person should actually be offered.
 *
 * CP-2's rule: a sidebar entry is a promise. A destination that renders only
 * fabricated data, or that is wired to a producer which does not exist, cannot
 * keep that promise, so it is not offered — `capabilityStatus.ts` says which,
 * with the evidence. It remains declared, addressable and testable; what
 * changes is that the product stops advertising it.
 */
export function visibleDestinationsOf(group: NavGroup): readonly Destination[] {
  return group.destinations.filter(destination => isDestinationVisible(destination.id));
}

/** Groups holding at least one destination worth offering. */
export const VISIBLE_NAV_GROUPS: readonly NavGroup[] = NAV_GROUPS
  .map(group => ({ ...group, destinations: [...visibleDestinationsOf(group)] }))
  .filter(group => group.destinations.length > 0);

/** Every destination a person is offered, in sidebar order. */
export const VISIBLE_DESTINATIONS: readonly Destination[] =
  VISIBLE_NAV_GROUPS.flatMap(group => group.destinations);

/**
 * Every destination the model DECLARES, in sidebar order.
 *
 * Declared is not the same as shown. `VISIBLE_DESTINATIONS` is what a person
 * sees; this is the full registry, and the deep-link resolver reads it so that
 * a URL naming a hidden destination still resolves to that destination rather
 * than silently becoming the Dashboard. Hiding something from the sidebar is a
 * statement about what to offer, never about what a URL means.
 */
export const DESTINATIONS: readonly Destination[] =
  NAV_GROUPS.flatMap(group => group.destinations);

const BY_ID = new Map<DestinationId, Destination>(
  DESTINATIONS.map(d => [d.id, d]),
);

export function getDestination(id: DestinationId): Destination | undefined {
  return BY_ID.get(id);
}

/** The destination's sidebar label, for breadcrumbs and titles. */
export function destinationLabel(id: DestinationId): string {
  return BY_ID.get(id)?.label ?? id;
}

/**
 * The route a destination rendered outside the shell lives at, or `undefined`
 * for one the shell renders itself.
 */
export function externalRouteFor(id: DestinationId): string | undefined {
  return BY_ID.get(id)?.externalRoute;
}

/** Destinations the team-dashboard shell renders in place. */
export const SHELL_DESTINATIONS: readonly Destination[] =
  DESTINATIONS.filter(d => !d.externalRoute);

/** Destinations that live at their own route. */
export const EXTERNAL_DESTINATIONS: readonly Destination[] =
  DESTINATIONS.filter(d => d.externalRoute);

/**
 * Destinations carrying a Cmd/Ctrl+N accelerator, in digit order.
 *
 * Read from the VISIBLE set. An accelerator for a destination the sidebar does
 * not offer is a third path to a place the product has decided not to send
 * anybody — Ch. 21.4's duplicate reality, arrived at from the other direction.
 */
export const SHORTCUT_DESTINATIONS: readonly Destination[] = VISIBLE_DESTINATIONS
  .filter((d): d is Destination & { shortcutDigit: number } =>
    typeof d.shortcutDigit === 'number')
  .sort((a, b) => a.shortcutDigit - b.shortcutDigit);
