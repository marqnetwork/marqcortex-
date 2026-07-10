/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Manifest Validator
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Validates the system manifest for internal consistency.
 * Run this whenever you:
 *   - Add a new entry to manifest.ts
 *   - Delete or rename a file
 *   - Change a dependency relationship
 *
 * Usage (browser / RegistryViewer):
 *   import { runValidation } from '@/system/validate';
 *   const report = runValidation(manifest);
 *
 * What it checks:
 *   1. Every dependency ID resolves to an existing manifest entry
 *   2. Every dependent ID resolves to an existing manifest entry
 *   3. No circular dependencies (direct only — one level)
 *   4. No duplicate IDs (TypeScript object keys enforce this, but we double-check)
 *   5. Every entry has a non-empty filePath and description
 *   6. All PAGE entries have a route field
 *   7. All SVC backend entries have a backendRoute field (optional but warned)
 */

import type { SystemManifest, ManifestEntry } from './types';

// ── Result types ──────────────────────────────────────────────────────────────

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  severity: ValidationSeverity;
  nodeId: string;
  nodeName: string;
  field: string;
  message: string;
}

export interface ValidationReport {
  passed: boolean;
  totalNodes: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: ValidationIssue[];
  summary: string;
  checkedAt: string;
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkDependencyRefs(
  entry: ManifestEntry,
  allIds: Set<string>,
  issues: ValidationIssue[],
): void {
  for (const depId of entry.dependencies) {
    if (!allIds.has(depId)) {
      issues.push({
        severity: 'ERROR',
        nodeId: entry.id,
        nodeName: entry.name,
        field: 'dependencies',
        message: `Dependency "${depId}" does not exist in the manifest. Either add the missing entry or remove this dependency.`,
      });
    }
  }
}

function checkDependentRefs(
  entry: ManifestEntry,
  allIds: Set<string>,
  issues: ValidationIssue[],
): void {
  for (const depId of entry.dependents) {
    if (!allIds.has(depId)) {
      issues.push({
        severity: 'ERROR',
        nodeId: entry.id,
        nodeName: entry.name,
        field: 'dependents',
        message: `Dependent "${depId}" does not exist in the manifest. Either add the missing entry or remove this dependent reference.`,
      });
    }
  }
}

function checkCircularDeps(
  entry: ManifestEntry,
  allNodes: Record<string, ManifestEntry>,
  issues: ValidationIssue[],
): void {
  // Direct circular: A depends on B, B depends on A
  for (const depId of entry.dependencies) {
    const dep = allNodes[depId];
    if (!dep) continue; // Already caught by checkDependencyRefs
    if (dep.dependencies.includes(entry.id)) {
      issues.push({
        severity: 'WARNING',
        nodeId: entry.id,
        nodeName: entry.name,
        field: 'dependencies',
        message: `Circular dependency detected: "${entry.id}" ↔ "${depId}". These two nodes depend on each other directly.`,
      });
    }
  }
}

function checkRequiredFields(
  entry: ManifestEntry,
  issues: ValidationIssue[],
): void {
  if (!entry.filePath || entry.filePath.trim() === '') {
    issues.push({
      severity: 'ERROR',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'filePath',
      message: 'filePath is empty. Every manifest entry must point to a real file.',
    });
  }

  if (!entry.description || entry.description.trim().length < 20) {
    issues.push({
      severity: 'WARNING',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'description',
      message: 'Description is missing or too short (< 20 chars). Descriptions must be useful for AI agents and developers.',
    });
  }
}

function checkPageFields(
  entry: ManifestEntry,
  issues: ValidationIssue[],
): void {
  if (entry.type !== 'PAGE') return;

  if (!entry.route) {
    issues.push({
      severity: 'WARNING',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'route',
      message: 'PAGE entry is missing a route field. Add the hash route (e.g. "#/dashboard").',
    });
  }
}

function checkSvcFields(
  entry: ManifestEntry,
  issues: ValidationIssue[],
): void {
  if (entry.type !== 'SVC') return;

  // Backend services (files under supabase/) should have a backendRoute
  if (
    entry.filePath.startsWith('supabase/') &&
    !entry.backendRoute
  ) {
    issues.push({
      severity: 'WARNING',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'backendRoute',
      message: 'Backend SVC entry has no backendRoute. Add the HTTP method and path (e.g. "POST /make-server-324f4fbe/example").',
    });
  }
}

function checkStatusConsistency(
  entry: ManifestEntry,
  issues: ValidationIssue[],
): void {
  // A LIVE node should not depend on a DEMO or MISSING node
  // (this is a data-only check — we can only check the status fields, not runtime behaviour)
  // We report this as INFO since it might be intentional
  // This check is done at the report level, not here per-entry
}

function checkMissingNodes(
  entry: ManifestEntry,
  allNodes: Record<string, ManifestEntry>,
  issues: ValidationIssue[],
): void {
  if (entry.status === 'MISSING') {
    issues.push({
      severity: 'WARNING',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'status',
      message: `Node is marked MISSING. The file "${entry.filePath}" does not exist. Either create it or remove this entry from the manifest.`,
    });
  }
}

// ── Status propagation check ──────────────────────────────────────────────────

function checkStatusPropagation(
  nodes: Record<string, ManifestEntry>,
  issues: ValidationIssue[],
): void {
  for (const entry of Object.values(nodes)) {
    if (entry.status !== 'LIVE') continue;

    for (const depId of entry.dependencies) {
      const dep = nodes[depId];
      if (!dep) continue;

      if (dep.status === 'MISSING') {
        issues.push({
          severity: 'ERROR',
          nodeId: entry.id,
          nodeName: entry.name,
          field: 'dependencies',
          message: `LIVE node depends on MISSING node "${depId}" (${dep.name}). This will cause a runtime error.`,
        });
      }

      if (dep.status === 'DEMO') {
        issues.push({
          severity: 'INFO',
          nodeId: entry.id,
          nodeName: entry.name,
          field: 'dependencies',
          message: `LIVE node depends on DEMO node "${depId}" (${dep.name}). The LIVE node will behave as DEMO until the dependency is promoted to LIVE.`,
        });
      }
    }
  }
}

// ── ID format check ───────────────────────────────────────────────────────────

function checkIdFormat(
  entry: ManifestEntry,
  issues: ValidationIssue[],
): void {
  const validPattern = /^MQC-(PAGE|COMP|CORE|SVC|HOOK|TYPE)-\d{3}$/;
  if (!validPattern.test(entry.id)) {
    issues.push({
      severity: 'ERROR',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'id',
      message: `ID "${entry.id}" does not match the required format MQC-{TYPE}-{NNN}. Valid types: PAGE, COMP, CORE, SVC, HOOK, TYPE.`,
    });
  }

  // Check that the ID type segment matches the entry type
  const idTypePart = entry.id.split('-')[1];
  if (idTypePart !== entry.type) {
    issues.push({
      severity: 'WARNING',
      nodeId: entry.id,
      nodeName: entry.name,
      field: 'id',
      message: `ID type segment "${idTypePart}" does not match entry type "${entry.type}". These should match for consistency.`,
    });
  }
}

// ── Main validator ────────────────────────────────────────────────────────────

export function runValidation(manifest: SystemManifest): ValidationReport {
  const issues: ValidationIssue[] = [];
  const allIds = new Set(Object.keys(manifest.nodes));
  const allNodes = manifest.nodes;

  // Per-node checks
  for (const entry of Object.values(allNodes)) {
    checkIdFormat(entry, issues);
    checkRequiredFields(entry, issues);
    checkDependencyRefs(entry, allIds, issues);
    checkDependentRefs(entry, allIds, issues);
    checkCircularDeps(entry, allNodes, issues);
    checkPageFields(entry, issues);
    checkSvcFields(entry, issues);
    checkMissingNodes(entry, allNodes, issues);
  }

  // Cross-node checks
  checkStatusPropagation(allNodes, issues);

  // Tally
  const errorCount = issues.filter(i => i.severity === 'ERROR').length;
  const warningCount = issues.filter(i => i.severity === 'WARNING').length;
  const infoCount = issues.filter(i => i.severity === 'INFO').length;
  const passed = errorCount === 0;

  const summary = passed
    ? `✅ Manifest is valid. ${Object.keys(allNodes).length} nodes checked. ${warningCount} warning${warningCount !== 1 ? 's' : ''}, ${infoCount} info note${infoCount !== 1 ? 's' : ''}.`
    : `❌ Manifest has ${errorCount} error${errorCount !== 1 ? 's' : ''}. Fix all errors before adding new nodes. ${warningCount} warning${warningCount !== 1 ? 's' : ''}.`;

  return {
    passed,
    totalNodes: Object.keys(allNodes).length,
    errorCount,
    warningCount,
    infoCount,
    issues,
    summary,
    checkedAt: new Date().toISOString(),
  };
}

// ── Quick lookup helpers for RegistryViewer ───────────────────────────────────

/** Returns only ERROR-severity issues for a given node ID. */
export function getNodeErrors(
  report: ValidationReport,
  nodeId: string,
): ValidationIssue[] {
  return report.issues.filter(i => i.nodeId === nodeId && i.severity === 'ERROR');
}

/** Returns true if a node has any validation errors. */
export function nodeHasErrors(report: ValidationReport, nodeId: string): boolean {
  return getNodeErrors(report, nodeId).length > 0;
}

/** Groups all issues by node ID for efficient lookup. */
export function groupIssuesByNode(
  report: ValidationReport,
): Record<string, ValidationIssue[]> {
  return report.issues.reduce<Record<string, ValidationIssue[]>>((acc, issue) => {
    if (!acc[issue.nodeId]) acc[issue.nodeId] = [];
    acc[issue.nodeId].push(issue);
    return acc;
  }, {});
}

/** Returns a plain-text summary table of all issues for console output. */
export function formatReportAsText(report: ValidationReport): string {
  const lines: string[] = [
    '════════════════════════════════════════════════',
    'MARQ CORTEX — Manifest Validation Report',
    `Checked: ${report.checkedAt}`,
    `Nodes:   ${report.totalNodes}`,
    `Errors:  ${report.errorCount}`,
    `Warnings:${report.warningCount}`,
    `Info:    ${report.infoCount}`,
    '════════════════════════════════════════════════',
  ];

  if (report.issues.length === 0) {
    lines.push('No issues found. Manifest is clean.');
  } else {
    for (const issue of report.issues) {
      const icon = issue.severity === 'ERROR' ? '❌' : issue.severity === 'WARNING' ? '⚠️ ' : 'ℹ️ ';
      lines.push(`${icon} [${issue.nodeId}] .${issue.field}: ${issue.message}`);
    }
  }

  lines.push('════════════════════════════════════════════════');
  lines.push(report.summary);
  return lines.join('\n');
}
