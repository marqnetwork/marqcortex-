/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — System Manifest Types
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * These interfaces define the shape of every entry in manifest.ts.
 * Import them wherever you need to read or validate manifest entries.
 */

// ── Entity types — the 6 categories every file in the system belongs to ──────

export type EntityType =
  | 'PAGE'   // A route/screen registered in App.tsx (maps to a page component)
  | 'COMP'   // A React component in /src/app/components
  | 'CORE'   // A deterministic engine module in /src/app/core
  | 'SVC'    // A service — frontend data layer or backend Hono route/AI service
  | 'HOOK'   // A React hook, context, or shared state provider
  | 'TYPE';  // A TypeScript schema / type definition file

// ── Lifecycle status — honest assessment of each node's current state ─────────

export type StatusType =
  | 'LIVE'    // Works end-to-end. No mock data. No feature flags bypassing it.
  | 'DEMO'    // Renders but uses mock/demo data (BACKEND_INTEGRATION: false path)
  | 'GATED'   // Exists but hidden behind a condition not yet met
  | 'MISSING' // Referenced in the system but file does not exist
  | 'SYSTEM'; // Internal dev/utility node — not part of the product surface

// ── Domain — the business area this node belongs to ───────────────────────────

export type DomainType =
  | 'AUTH'        // Login, auth, roles, team management
  | 'DIAGNOSTIC'  // The 14-question diagnostic form and scoring
  | 'PROPOSAL'    // Proposal drafting, contracts, architecture cards
  | 'ROI'         // ROI engine, DCF, Monte Carlo, scenario modelling
  | 'PORTAL'      // Client-facing portal and its 8 tabs
  | 'AI'          // AI chat, copilot, narrative, objection handling
  | 'EXECUTION'   // Sprint execution, kanban, pipeline
  | 'ANALYTICS'   // Dashboards, revenue intelligence, engagement
  | 'COMMS'       // Email, messaging, notifications
  | 'LEAD'        // Landing page, lead capture, exit intent
  | 'REVIEWER'    // QA review, transcript, submission notes
  | 'SYSTEM';     // Registry, architecture, error boundaries, utilities

// ── Core manifest entry ───────────────────────────────────────────────────────

export interface ManifestEntry {
  /** Unique ID. Format: MQC-{TYPE}-{NNN}. Never changes once assigned. */
  id: string;

  /** Human-readable name. Should match the export name of the file. */
  name: string;

  /** The 6-category entity type. */
  type: EntityType;

  /** Honest lifecycle status. Do not mark LIVE unless it is end-to-end working. */
  status: StatusType;

  /** Business domain this node belongs to. */
  domain: DomainType;

  /**
   * Path to the file, relative to the project root.
   * This is the single most important field — it is how any AI or agent
   * navigates from an ID to the actual code without scanning the filesystem.
   * Example: "src/app/components/DiagnosticForm.tsx"
   */
  filePath: string;

  /**
   * One or two sentences describing what this node does.
   * Write it as if explaining to a new engineer on day one.
   * Do not describe HOW it works — describe WHAT it does and WHY it exists.
   */
  description: string;

  /**
   * IDs of manifest entries this node directly imports or calls.
   * Keep this to direct, hard dependencies only — not transitive ones.
   * This is what breaks if you delete or rename this node's dependencies.
   */
  dependencies: string[];

  /**
   * IDs of manifest entries that import or call this node.
   * Populated for high-value nodes to make impact analysis instant.
   * Can be left empty — filled in over time as the codebase grows.
   */
  dependents: string[];

  /** For PAGE type only: the hash route this page is registered under. */
  route?: string;

  /**
   * For SVC type backend nodes: the HTTP method and path of the Hono route.
   * Example: "POST /make-server-324f4fbe/submissions"
   */
  backendRoute?: string;

  /**
   * Primary data types this node consumes.
   * Use the TypeScript type name from /src/app/types/* or a plain description.
   */
  inputs?: string[];

  /**
   * Primary data types or side-effects this node produces.
   * Use the TypeScript type name or a plain description.
   */
  outputs?: string[];

  /**
   * Free-text field for known issues, technical debt, or notes for any
   * AI agent or developer reading this entry.
   * If empty: node is clean. If populated: read before touching the file.
   */
  notes?: string;
}

// ── Manifest shape ────────────────────────────────────────────────────────────

export interface SystemManifest {
  /**
   * Schema version. Increment the minor version when adding fields,
   * increment the major version when changing ID formats or removing fields.
   */
  version: string;

  /** ISO date string of last manual verification pass. */
  lastVerified: string;

  /**
   * The product principle that governs the entire system.
   * Any AI reading this manifest should understand this rule before making changes.
   */
  coreRule: string;

  /** Whether the system is currently running in live or demo mode. */
  backendIntegration: boolean;

  /** All manifest entries, keyed by their ID for O(1) lookup. */
  nodes: Record<string, ManifestEntry>;
}

// ── Lookup helpers (pure functions — no side effects) ─────────────────────────

/** Get a single entry by ID. Returns undefined if not found. */
export function getNode(manifest: SystemManifest, id: string): ManifestEntry | undefined {
  return manifest.nodes[id];
}

/** Get all entries of a given entity type. */
export function getByType(manifest: SystemManifest, type: EntityType): ManifestEntry[] {
  return Object.values(manifest.nodes).filter(n => n.type === type);
}

/** Get all entries in a given domain. */
export function getByDomain(manifest: SystemManifest, domain: DomainType): ManifestEntry[] {
  return Object.values(manifest.nodes).filter(n => n.domain === domain);
}

/** Get all entries with a given status. */
export function getByStatus(manifest: SystemManifest, status: StatusType): ManifestEntry[] {
  return Object.values(manifest.nodes).filter(n => n.status === status);
}

/** Get the full dependency chain for a node (direct deps only, one level). */
export function getDependencies(manifest: SystemManifest, id: string): ManifestEntry[] {
  const node = manifest.nodes[id];
  if (!node) return [];
  return node.dependencies
    .map(depId => manifest.nodes[depId])
    .filter(Boolean) as ManifestEntry[];
}

/** Get all nodes that directly depend on the given ID. */
export function getDependents(manifest: SystemManifest, id: string): ManifestEntry[] {
  return Object.values(manifest.nodes).filter(n => n.dependencies.includes(id));
}

/** Search entries by name or description substring (case-insensitive). */
export function search(manifest: SystemManifest, query: string): ManifestEntry[] {
  const q = query.toLowerCase();
  return Object.values(manifest.nodes).filter(
    n =>
      n.name.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q),
  );
}
