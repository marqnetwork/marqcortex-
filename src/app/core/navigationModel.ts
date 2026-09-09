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
        label: 'Team',
        description: 'Members, roles and permissions',
        icon: Users,
        group: 'administer',
        tier: 'secondary',
        keywords: ['members', 'people', 'permissions', 'roles', 'access'],
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
 */
export function isSystemGroup(group: NavGroup): boolean {
  return group.destinations.every(destination => destination.tier === 'system');
}

/** Every destination, in sidebar order. */
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

/** Destinations carrying a Cmd/Ctrl+N accelerator, in digit order. */
export const SHORTCUT_DESTINATIONS: readonly Destination[] = DESTINATIONS
  .filter((d): d is Destination & { shortcutDigit: number } =>
    typeof d.shortcutDigit === 'number')
  .sort((a, b) => a.shortcutDigit - b.shortcutDigit);
