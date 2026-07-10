/**
 * MARQ CORTEX — System Registry Viewer
 *
 * Reads directly from /src/system/manifest.ts — no hardcoded data.
 * 7 tabs: Registry · Validation · Stats · Dependencies · Processes · Interactions · Audit
 *
 * Performance:
 *   - Search is debounced (300ms)
 *   - Nodes render in pages of 25 with a "Show More" button
 *   - Validation runs lazily (only when the Validation tab is opened)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { manifest } from '../../system/manifest';
import { runValidation } from '../../system/validate';
import {
  search as manifestSearch,
} from '../../system/types';
import type {
  ManifestEntry,
  EntityType,
  StatusType,
  DomainType,
  ValidationReport,
} from '../../system/types';
// ── F-002: wire in previously-orphaned registry data ─────────────────────────
import { PROCESSES } from '../utils/registryProcesses';
import type { MQCProcess, ProcessStatus } from '../utils/registryProcesses';
import { AUDIT, AUDIT_SUMMARY } from '../utils/registryAudit';
import type { AuditEntry, AuditStatus } from '../utils/registryAudit';

// ── Inline debounce (avoids circular hook dependency) ────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

const TABS = [
  { id: 'registry',     label: 'Registry' },
  { id: 'validation',   label: 'Validation' },
  { id: 'stats',        label: 'Stats' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'processes',    label: 'Processes' },
  { id: 'interactions', label: 'Interactions' },
  { id: 'audit',        label: 'Audit' },
] as const;
type TabId = typeof TABS[number]['id'];

// ── Colour maps ───────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<StatusType, { bg: string; text: string; dot: string }> = {
  LIVE:    { bg: 'rgba(16,185,129,0.12)',  text: '#10B981', dot: '#10B981' },
  DEMO:    { bg: 'rgba(245,158,11,0.12)',  text: '#F59E0B', dot: '#F59E0B' },
  GATED:   { bg: 'rgba(139,92,246,0.12)', text: '#8B5CF6', dot: '#8B5CF6' },
  MISSING: { bg: 'rgba(239,68,68,0.12)',  text: '#EF4444', dot: '#EF4444' },
  SYSTEM:  { bg: 'rgba(107,114,128,0.12)', text: '#6B7280', dot: '#6B7280' },
};

// Audit status colour map — adds VISUAL which manifest StatusType doesn't have
const AUDIT_STATUS_COLORS: Record<AuditStatus, { bg: string; text: string; dot: string }> = {
  LIVE:    { bg: 'rgba(16,185,129,0.12)',  text: '#10B981', dot: '#10B981' },
  DEMO:    { bg: 'rgba(245,158,11,0.12)',  text: '#F59E0B', dot: '#F59E0B' },
  GATED:   { bg: 'rgba(139,92,246,0.12)', text: '#8B5CF6', dot: '#8B5CF6' },
  MISSING: { bg: 'rgba(239,68,68,0.12)',  text: '#EF4444', dot: '#EF4444' },
  VISUAL:  { bg: 'rgba(107,114,128,0.12)', text: '#6B7280', dot: '#6B7280' },
};

const PROCESS_STATUS_COLORS: Record<ProcessStatus, { text: string; bg: string }> = {
  stable:      { text: '#10B981', bg: 'rgba(16,185,129,0.10)' },
  watch:       { text: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  hot:         { text: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
  'demo-only': { text: '#8B5CF6', bg: 'rgba(139,92,246,0.10)' },
  partial:     { text: '#60A5FA', bg: 'rgba(59,130,246,0.10)' },
};

const TYPE_COLORS: Record<EntityType, { bg: string; text: string }> = {
  PAGE: { bg: 'rgba(59,130,246,0.15)',   text: '#60A5FA' },
  COMP: { bg: 'rgba(139,92,246,0.15)',   text: '#A78BFA' },
  CORE: { bg: 'rgba(16,185,129,0.15)',   text: '#34D399' },
  SVC:  { bg: 'rgba(251,146,60,0.15)',   text: '#FB923C' },
  HOOK: { bg: 'rgba(34,211,238,0.15)',   text: '#22D3EE' },
  TYPE: { bg: 'rgba(156,163,175,0.15)',  text: '#9CA3AF' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusType }) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 4,
      background: c.bg, color: c.text,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: EntityType }) {
  const c = TYPE_COLORS[type];
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 4,
      background: c.bg, color: c.text,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    }}>
      {type}
    </span>
  );
}

function NodeCard({
  entry,
  allNodes,
  onClick,
}: {
  entry: ManifestEntry;
  allNodes: Record<string, ManifestEntry>;
  onClick: (e: ManifestEntry) => void;
}) {
  return (
    <div
      onClick={() => onClick(entry)}
      style={{
        background: '#111118',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{entry.id}</span>
        <TypeBadge type={entry.type} />
        <StatusBadge status={entry.status} />
        {entry.notes && (
          <span style={{ fontSize: 10, color: '#F59E0B', background: 'rgba(245,158,11,0.08)', padding: '1px 6px', borderRadius: 3 }}>
            ⚠ notes
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, color: '#E5E7EB', fontSize: 13, marginBottom: 4 }}>
        {entry.name}
      </div>
      <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5, marginBottom: 8 }}>
        {entry.description}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4B5563', wordBreak: 'break-all' }}>
        {entry.filePath}
      </div>
      {entry.dependencies.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {entry.dependencies.map(depId => {
            const dep = allNodes[depId];
            return (
              <span key={depId} style={{
                fontSize: 10, fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.05)',
                color: '#6B7280', padding: '1px 6px', borderRadius: 3,
              }}>
                {dep ? dep.name : depId}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodeDetailPanel({
  entry,
  allNodes,
  onClose,
}: {
  entry: ManifestEntry;
  allNodes: Record<string, ManifestEntry>;
  onClose: () => void;
}) {
  const deps = entry.dependencies.map(id => allNodes[id]).filter(Boolean) as ManifestEntry[];
  const dependents = Object.values(allNodes).filter(n => n.dependencies.includes(entry.id));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }} onClick={onClose}>
      <div
        style={{
          background: '#0F0F1A', border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: 12, padding: 28, maxWidth: 680, width: '100%',
          maxHeight: '80vh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8B5CF6' }}>{entry.id}</span>
              <TypeBadge type={entry.type} />
              <StatusBadge status={entry.status} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F9FAFB' }}>{entry.name}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#6B7280',
            cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>

        <Section label="Description">
          <p style={{ color: '#D1D5DB', fontSize: 13, lineHeight: 1.6, margin: 0 }}>{entry.description}</p>
        </Section>

        <Section label="File Path">
          <code style={{ fontFamily: 'monospace', fontSize: 12, color: '#34D399', background: 'rgba(16,185,129,0.08)', padding: '4px 8px', borderRadius: 4, display: 'block', wordBreak: 'break-all' }}>
            {entry.filePath}
          </code>
        </Section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Section label="Domain">
            <span style={{ color: '#A78BFA', fontSize: 12 }}>{entry.domain}</span>
          </Section>
          {entry.route && (
            <Section label="Route">
              <code style={{ color: '#60A5FA', fontSize: 12 }}>{entry.route}</code>
            </Section>
          )}
          {entry.backendRoute && (
            <Section label="Backend Route">
              <code style={{ color: '#FB923C', fontSize: 12 }}>{entry.backendRoute}</code>
            </Section>
          )}
        </div>

        {(entry.inputs?.length || entry.outputs?.length) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {entry.inputs && entry.inputs.length > 0 && (
              <Section label="Inputs">
                {entry.inputs.map(i => (
                  <span key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: '#9CA3AF', display: 'block' }}>{i}</span>
                ))}
              </Section>
            )}
            {entry.outputs && entry.outputs.length > 0 && (
              <Section label="Outputs">
                {entry.outputs.map(o => (
                  <span key={o} style={{ fontSize: 11, fontFamily: 'monospace', color: '#9CA3AF', display: 'block' }}>{o}</span>
                ))}
              </Section>
            )}
          </div>
        )}

        {deps.length > 0 && (
          <Section label={`Dependencies (${deps.length})`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {deps.map(d => (
                <span key={d.id} style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.05)', color: '#D1D5DB',
                  fontFamily: 'monospace',
                }}>
                  <span style={{ color: '#6B7280', fontSize: 10 }}>{d.id} </span>{d.name}
                </span>
              ))}
            </div>
          </Section>
        )}

        {dependents.length > 0 && (
          <Section label={`Used by (${dependents.length})`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dependents.map(d => (
                <span key={d.id} style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.05)', color: '#D1D5DB',
                  fontFamily: 'monospace',
                }}>
                  <span style={{ color: '#6B7280', fontSize: 10 }}>{d.id} </span>{d.name}
                </span>
              ))}
            </div>
          </Section>
        )}

        {entry.notes && (
          <Section label="⚠ Notes">
            <p style={{ color: '#FCD34D', fontSize: 12, lineHeight: 1.6, margin: 0, background: 'rgba(245,158,11,0.06)', padding: '10px 12px', borderRadius: 6 }}>
              {entry.notes}
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function RegistryTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<EntityType | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusType | 'ALL'>('ALL');
  const [domainFilter, setDomainFilter] = useState<DomainType | 'ALL'>('ALL');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ManifestEntry | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  const allEntries = useMemo(() => Object.values(allNodes), [allNodes]);

  const domains = useMemo(() =>
    Array.from(new Set(allEntries.map(e => e.domain))).sort(),
    [allEntries],
  );

  const filtered = useMemo(() => {
    let list = debouncedQuery.trim()
      ? manifestSearch(manifest, debouncedQuery)
      : allEntries;
    if (typeFilter !== 'ALL') list = list.filter(e => e.type === typeFilter);
    if (statusFilter !== 'ALL') list = list.filter(e => e.status === statusFilter);
    if (domainFilter !== 'ALL') list = list.filter(e => e.domain === domainFilter);
    return list;
  }, [debouncedQuery, allEntries, typeFilter, statusFilter, domainFilter]);

  const visibleNodes = filtered.slice(0, visible);

  return (
    <span className="contents">
      {selected && (
        <NodeDetailPanel
          entry={selected}
          allNodes={allNodes}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
          placeholder="Search by name, ID, or description…"
          style={{
            flex: 1, minWidth: 200,
            background: '#111118', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, padding: '8px 12px',
            color: '#E5E7EB', fontSize: 13, outline: 'none',
          }}
        />
        <FilterSelect value={typeFilter} onChange={v => { setTypeFilter(v as EntityType | 'ALL'); setVisible(PAGE_SIZE); }}
          options={['ALL', 'PAGE', 'COMP', 'CORE', 'SVC', 'HOOK', 'TYPE']} label="Type" />
        <FilterSelect value={statusFilter} onChange={v => { setStatusFilter(v as StatusType | 'ALL'); setVisible(PAGE_SIZE); }}
          options={['ALL', 'LIVE', 'DEMO', 'GATED', 'MISSING', 'SYSTEM']} label="Status" />
        <FilterSelect value={domainFilter} onChange={v => { setDomainFilter(v as DomainType | 'ALL'); setVisible(PAGE_SIZE); }}
          options={['ALL', ...domains]} label="Domain" />
      </div>

      {/* Count */}
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
        Showing <strong style={{ color: '#9CA3AF' }}>{Math.min(visible, filtered.length)}</strong> of{' '}
        <strong style={{ color: '#9CA3AF' }}>{filtered.length}</strong> nodes
        {filtered.length !== allEntries.length && ` (${allEntries.length} total)`}
      </div>

      {/* Node list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visibleNodes.map(entry => (
          <NodeCard
            key={entry.id}
            entry={entry}
            allNodes={allNodes}
            onClick={setSelected}
          />
        ))}
      </div>

      {/* Show More */}
      {visible < filtered.length && (
        <button
          onClick={() => setVisible(v => v + PAGE_SIZE)}
          style={{
            marginTop: 16, width: '100%', padding: '10px',
            background: 'rgba(139,92,246,0.1)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: 8, color: '#A78BFA', cursor: 'pointer', fontSize: 13,
          }}
        >
          Show {Math.min(PAGE_SIZE, filtered.length - visible)} more
          <span style={{ color: '#6B7280', marginLeft: 8 }}>({filtered.length - visible} remaining)</span>
        </button>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#4B5563' }}>
          No nodes match your filters.
        </div>
      )}
    </span>
  );
}

function FilterSelect({
  value, onChange, options, label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: '#111118', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '8px 10px',
        color: '#9CA3AF', fontSize: 12, outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => (
        <option key={o} value={o}>{o === 'ALL' ? `All ${label}s` : o}</option>
      ))}
    </select>
  );
}

function ValidationTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      setReport(runValidation(manifest));
      setRunning(false);
    }, 100);
  }, []);

  const grouped = useMemo(() => {
    if (!report) return {};
    return report.issues.reduce<Record<string, typeof report.issues>>((acc, issue) => {
      if (!acc[issue.severity]) acc[issue.severity] = [];
      acc[issue.severity].push(issue);
      return acc;
    }, {});
  }, [report]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button
          onClick={run}
          disabled={running}
          style={{
            padding: '9px 20px',
            background: running ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)',
            border: '1px solid rgba(139,92,246,0.4)',
            borderRadius: 8, color: '#A78BFA', cursor: running ? 'default' : 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          {running ? 'Running…' : '▶ Run Validation'}
        </button>
        {report && (
          <span style={{
            fontSize: 13,
            color: report.passed ? '#10B981' : '#EF4444',
            fontWeight: 600,
          }}>
            {report.passed ? '✅ All checks passed' : `❌ ${report.errorCount} error${report.errorCount !== 1 ? 's' : ''} found`}
          </span>
        )}
      </div>

      {!report && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#4B5563' }}>
          Click "Run Validation" to check manifest integrity.
        </div>
      )}

      {report && (
        <span className="contents">
          {/* Summary pills */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Nodes', value: report.totalNodes, color: '#6B7280' },
              { label: 'Errors', value: report.errorCount, color: '#EF4444' },
              { label: 'Warnings', value: report.warningCount, color: '#F59E0B' },
              { label: 'Info', value: report.infoCount, color: '#60A5FA' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: '#111118', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8, padding: '12px 20px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Issues */}
          {['ERROR', 'WARNING', 'INFO'].map(sev => {
            const issues = grouped[sev] || [];
            if (issues.length === 0) return null;
            const color = sev === 'ERROR' ? '#EF4444' : sev === 'WARNING' ? '#F59E0B' : '#60A5FA';
            const icon = sev === 'ERROR' ? '❌' : sev === 'WARNING' ? '⚠️' : 'ℹ️';
            return (
              <div key={sev} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 8, letterSpacing: '0.06em' }}>
                  {icon} {sev} ({issues.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {issues.map((issue, i) => (
                    <div key={i} style={{
                      background: '#111118', border: `1px solid ${color}22`,
                      borderLeft: `3px solid ${color}`, borderRadius: 6,
                      padding: '10px 12px',
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8B5CF6' }}>{issue.nodeId}</span>
                        <span style={{ color: '#6B7280', fontSize: 11 }}>{issue.nodeName}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#4B5563' }}>.{issue.field}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#D1D5DB' }}>{issue.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {report.issues.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '32px', background: 'rgba(16,185,129,0.05)',
              border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, color: '#10B981',
            }}>
              Manifest is clean. Every ID resolves. Every dependency exists.
            </div>
          )}
        </span>
      )}
    </div>
  );
}

function StatsTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const entries = useMemo(() => Object.values(allNodes), [allNodes]);

  const byType = useMemo(() => {
    const counts: Partial<Record<EntityType, number>> = {};
    for (const e of entries) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts;
  }, [entries]);

  const byStatus = useMemo(() => {
    const counts: Partial<Record<StatusType, number>> = {};
    for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return counts;
  }, [entries]);

  const byDomain = useMemo(() => {
    const counts: Partial<Record<DomainType, number>> = {};
    for (const e of entries) counts[e.domain] = (counts[e.domain] ?? 0) + 1;
    return (Object.entries(counts) as [DomainType, number][]).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const withNotes = entries.filter(e => e.notes).length;
  const withDeps = entries.filter(e => e.dependencies.length > 0).length;
  const livePercent = Math.round(((byStatus.LIVE ?? 0) / entries.length) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Headline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        {[
          { label: 'Total Nodes', value: entries.length, color: '#A78BFA' },
          { label: 'LIVE', value: `${livePercent}%`, color: '#10B981' },
          { label: 'With Notes', value: withNotes, color: '#F59E0B' },
          { label: 'Have Deps', value: withDeps, color: '#60A5FA' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: '#111118', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, padding: '18px 16px',
          }}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* By Type */}
        <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>By Type</div>
          {(['PAGE', 'COMP', 'CORE', 'SVC', 'HOOK', 'TYPE'] as EntityType[]).map(type => {
            const count = byType[type] ?? 0;
            const pct = Math.round((count / entries.length) * 100);
            const c = TYPE_COLORS[type];
            return (
              <div key={type} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: c.text, fontWeight: 600 }}>{type}</span>
                  <span style={{ color: '#6B7280' }}>{count}</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: c.text, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* By Status */}
        <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>By Status</div>
          {(['LIVE', 'DEMO', 'GATED', 'MISSING', 'SYSTEM'] as StatusType[]).map(status => {
            const count = byStatus[status] ?? 0;
            const pct = Math.round((count / entries.length) * 100);
            const c = STATUS_COLORS[status];
            return (
              <div key={status} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: c.text, fontWeight: 600 }}>{status}</span>
                  <span style={{ color: '#6B7280' }}>{count}</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: c.dot, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By Domain */}
      <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>By Domain</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {byDomain.map(([domain, count]) => (
            <div key={domain} style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 6, padding: '10px 12px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>{domain}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#E5E7EB' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Manifest metadata */}
      <div style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Manifest Metadata</div>
        {[
          { label: 'Version', value: manifest.version },
          { label: 'Last Verified', value: manifest.lastVerified },
          { label: 'Backend Integration', value: manifest.backendIntegration ? 'LIVE' : 'DEMO MODE' },
          { label: 'Core Rule', value: manifest.coreRule },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: '#4B5563', minWidth: 160 }}>{label}</span>
            <span style={{ color: '#D1D5DB' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DependenciesTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ManifestEntry | null>(null);
  const debouncedQuery = useDebounce(query, 300);

  const entries = useMemo(() => Object.values(allNodes), [allNodes]);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return entries.filter(e => e.dependencies.length > 0);
    const q = debouncedQuery.toLowerCase();
    return entries.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q),
    );
  }, [entries, debouncedQuery]);

  const depDetail = useMemo(() => {
    if (!selected) return null;
    const deps = selected.dependencies.map(id => allNodes[id]).filter(Boolean) as ManifestEntry[];
    const dependents = entries.filter(e => e.dependencies.includes(selected.id));
    return { deps, dependents };
  }, [selected, allNodes, entries]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
      <div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search nodes…"
          style={{
            width: '100%', boxSizing: 'border-box', marginBottom: 12,
            background: '#111118', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, padding: '8px 12px',
            color: '#E5E7EB', fontSize: 13, outline: 'none',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 560, overflowY: 'auto' }}>
          {filtered.map(entry => (
            <div
              key={entry.id}
              onClick={() => setSelected(selected?.id === entry.id ? null : entry)}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                background: selected?.id === entry.id ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${selected?.id === entry.id ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.04)'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <TypeBadge type={entry.type} />
              <span style={{ fontSize: 13, color: '#E5E7EB', flex: 1 }}>{entry.name}</span>
              <span style={{ fontSize: 11, color: '#6B7280' }}>
                {entry.dependencies.length}↓ {entries.filter(e => e.dependencies.includes(entry.id)).length}↑
              </span>
            </div>
          ))}
        </div>
      </div>

      {selected && depDetail && (
        <div>
          <div style={{ background: '#111118', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8B5CF6', marginBottom: 4 }}>{selected.id}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F9FAFB', marginBottom: 8 }}>{selected.name}</div>
            <StatusBadge status={selected.status} />
          </div>

          <DepSection title={`Depends on (${depDetail.deps.length})`} nodes={depDetail.deps} color="#FB923C" arrow="↓" />
          <DepSection title={`Used by (${depDetail.dependents.length})`} nodes={depDetail.dependents} color="#34D399" arrow="↑" />
        </div>
      )}
    </div>
  );
}

function DepSection({
  title, nodes, color, arrow,
}: {
  title: string; nodes: ManifestEntry[]; color: string; arrow: string;
}) {
  if (nodes.length === 0) return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: '#4B5563', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#374151', fontStyle: 'italic' }}>None</div>
    </div>
  );
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: color, fontWeight: 600, marginBottom: 8 }}>{arrow} {title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {nodes.map(n => (
          <div key={n.id} style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <TypeBadge type={n.type} />
            <span style={{ fontSize: 12, color: '#D1D5DB', flex: 1 }}>{n.name}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#4B5563' }}>{n.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessesTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<ProcessStatus | 'ALL'>('ALL');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  const domains = useMemo(() =>
    Array.from(new Set(PROCESSES.map(p => p.domain))).sort(), []);

  const filtered = useMemo(() => {
    let list: MQCProcess[] = [...PROCESSES];
    if (statusFilter !== 'ALL') list = list.filter(p => p.status === statusFilter);
    if (domainFilter !== 'ALL') list = list.filter(p => p.domain === domainFilter);
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter(p =>
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.trigger.toLowerCase().includes(q) ||
        p.outcome.toLowerCase().includes(q),
      );
    }
    return list;
  }, [debouncedQuery, domainFilter, statusFilter]);

  return (
    <span className="contents">
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
        <strong style={{ color: '#9CA3AF' }}>{PROCESSES.length}</strong> end-to-end workflow processes — trigger → steps → outcome · Math decides priority.
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
          placeholder="Search processes…"
          style={{
            flex: 1, minWidth: 200,
            background: '#111118', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, padding: '8px 12px', color: '#E5E7EB', fontSize: 13, outline: 'none',
          }}
        />
        <FilterSelect value={domainFilter} onChange={v => { setDomainFilter(v); setVisible(PAGE_SIZE); }}
          options={['ALL', ...domains]} label="Domain" />
        <FilterSelect value={statusFilter} onChange={v => { setStatusFilter(v as ProcessStatus | 'ALL'); setVisible(PAGE_SIZE); }}
          options={['ALL', 'stable', 'watch', 'hot', 'demo-only', 'partial']} label="Status" />
      </div>

      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
        Showing <strong style={{ color: '#9CA3AF' }}>{Math.min(visible, filtered.length)}</strong> of{' '}
        <strong style={{ color: '#9CA3AF' }}>{filtered.length}</strong> processes
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.slice(0, visible).map(proc => {
          const sc = PROCESS_STATUS_COLORS[proc.status];
          const isOpen = expanded === proc.id;
          return (
            <div
              key={proc.id}
              style={{
                background: '#111118',
                border: `1px solid ${isOpen ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
              }}
              onClick={() => setExpanded(isOpen ? null : proc.id)}
            >
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{proc.id}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 8px', borderRadius: 4,
                  background: sc.bg, color: sc.text, flexShrink: 0,
                }}>{proc.status.toUpperCase()}</span>
                <span style={{
                  fontSize: 10, color: '#8B5CF6', background: 'rgba(139,92,246,0.08)',
                  padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                }}>{proc.domain}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', flex: 1 }}>{proc.label}</span>
                {proc.featureFlag && (
                  <span style={{ fontSize: 10, color: '#F59E0B', background: 'rgba(245,158,11,0.08)', padding: '2px 6px', borderRadius: 3 }}>
                    🚩 {proc.featureFlag}
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#4B5563', flexShrink: 0 }}>{proc.steps.length} steps {isOpen ? '▲' : '▼'}</span>
              </div>

              {isOpen && (
                <div style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Trigger</div>
                      <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>{proc.trigger}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Outcome</div>
                      <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>{proc.outcome}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Steps ({proc.steps.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {proc.steps.map((stepId, i) => {
                        const node = allNodes[stepId];
                        return (
                          <span key={stepId} style={{
                            fontSize: 10, fontFamily: 'monospace',
                            background: 'rgba(139,92,246,0.08)', color: '#A78BFA',
                            padding: '2px 7px', borderRadius: 4,
                          }}>
                            {i + 1}. {node ? node.name : stepId}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {proc.notes && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 6 }}>
                      <span style={{ fontSize: 11, color: '#FCD34D', lineHeight: 1.5 }}>{proc.notes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {visible < filtered.length && (
        <button
          onClick={() => setVisible(v => v + PAGE_SIZE)}
          style={{
            marginTop: 16, width: '100%', padding: '10px',
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 8, color: '#34D399', cursor: 'pointer', fontSize: 13,
          }}
        >
          Show more ({filtered.length - visible} remaining)
        </button>
      )}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#4B5563' }}>No processes match.</div>
      )}
    </span>
  );
}

function InteractionsTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AuditStatus | 'ALL'>('ALL');
  const [componentFilter, setComponentFilter] = useState('ALL');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const debouncedQuery = useDebounce(query, 300);

  const components = useMemo(() =>
    Array.from(new Set(AUDIT.map(a => a.component))).sort(), []);

  const filtered = useMemo(() => {
    let list: AuditEntry[] = [...AUDIT];
    if (statusFilter !== 'ALL') list = list.filter(a => a.status === statusFilter);
    if (componentFilter !== 'ALL') list = list.filter(a => a.component === componentFilter);
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter(a =>
        a.label.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.component.toLowerCase().includes(q) ||
        a.evidence.toLowerCase().includes(q),
      );
    }
    return list;
  }, [debouncedQuery, statusFilter, componentFilter]);

  return (
    <span className="contents">
      {/* Status pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['LIVE', 'DEMO', 'GATED', 'MISSING', 'VISUAL'] as AuditStatus[]).map(s => {
          const c = AUDIT_STATUS_COLORS[s];
          const count = AUDIT.filter(a => a.status === s).length;
          return (
            <div
              key={s}
              onClick={() => { setStatusFilter(statusFilter === s ? 'ALL' : s); setVisible(PAGE_SIZE); }}
              style={{
                background: statusFilter === s ? c.bg : '#111118',
                border: `1px solid ${statusFilter === s ? c.dot : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 8, padding: '8px 14px', cursor: 'pointer', textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 800, color: c.dot }}>{count}</div>
              <div style={{ fontSize: 10, color: c.text, fontWeight: 600, letterSpacing: '0.06em', marginTop: 2 }}>{s}</div>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: '#4B5563', alignSelf: 'center', marginLeft: 4 }}>
          {AUDIT_SUMMARY.total} total
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
          placeholder="Search by label, ID, component, or evidence…"
          style={{
            flex: 1, minWidth: 200,
            background: '#111118', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, padding: '8px 12px', color: '#E5E7EB', fontSize: 13, outline: 'none',
          }}
        />
        <FilterSelect value={componentFilter}
          onChange={v => { setComponentFilter(v); setVisible(PAGE_SIZE); }}
          options={['ALL', ...components]} label="Component" />
      </div>

      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
        Showing <strong style={{ color: '#9CA3AF' }}>{Math.min(visible, filtered.length)}</strong> of{' '}
        <strong style={{ color: '#9CA3AF' }}>{filtered.length}</strong> interactions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {filtered.slice(0, visible).map(entry => {
          const c = AUDIT_STATUS_COLORS[entry.status];
          return (
            <div
              key={entry.id}
              style={{
                background: '#111118',
                border: `1px solid ${entry.status === 'MISSING' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)'}`,
                borderLeft: entry.status === 'MISSING' ? '3px solid #EF4444' : '3px solid transparent',
                borderRadius: 7,
                padding: '10px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B7280', flexShrink: 0 }}>{entry.id}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 7px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: c.bg, color: c.text, flexShrink: 0,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.dot, display: 'inline-block' }} />
                  {entry.status}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', flex: 1 }}>{entry.label}</span>
                <span style={{ fontSize: 11, color: '#4B5563', flexShrink: 0 }}>{entry.component}</span>
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5, fontStyle: 'italic' }}>
                {entry.evidence}
              </div>
              {entry.fixHint && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#EF4444', marginRight: 6 }}>FIX HINT</span>
                  <span style={{ fontSize: 11, color: '#FCA5A5' }}>{entry.fixHint}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {visible < filtered.length && (
        <button
          onClick={() => setVisible(v => v + PAGE_SIZE)}
          style={{
            marginTop: 16, width: '100%', padding: '10px',
            background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
            borderRadius: 8, color: '#A78BFA', cursor: 'pointer', fontSize: 13,
          }}
        >
          Show more ({filtered.length - visible} remaining)
        </button>
      )}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#4B5563' }}>No interactions match.</div>
      )}
    </span>
  );
}

function AuditTab({ allNodes }: { allNodes: Record<string, ManifestEntry> }) {
  const entries = useMemo(() => Object.values(allNodes), [allNodes]);
  const [selectedManifestStatus, setSelectedManifestStatus] = useState<StatusType | null>(null);

  const byManifestStatus = useMemo(() => {
    const map: Record<StatusType, ManifestEntry[]> = { LIVE: [], DEMO: [], GATED: [], MISSING: [], SYSTEM: [] };
    for (const e of entries) map[e.status].push(e);
    return map;
  }, [entries]);

  const nodesWithNotes = useMemo(() => entries.filter(e => e.notes), [entries]);
  const statusOrder: StatusType[] = ['LIVE', 'DEMO', 'GATED', 'MISSING', 'SYSTEM'];

  const missingInteractions = AUDIT_SUMMARY.missing_entries;
  const gatedInteractions   = AUDIT_SUMMARY.gated_entries;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Section 1: Interaction Audit ─────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
          Interaction Audit — {AUDIT_SUMMARY.total} buttons / inputs / shortcuts classified
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'LIVE',    value: AUDIT_SUMMARY.live,    color: '#10B981' },
            { label: 'DEMO',    value: AUDIT_SUMMARY.demo,    color: '#F59E0B' },
            { label: 'GATED',   value: AUDIT_SUMMARY.gated,   color: '#8B5CF6' },
            { label: 'MISSING', value: AUDIT_SUMMARY.missing, color: '#EF4444' },
            { label: 'VISUAL',  value: AUDIT_SUMMARY.visual,  color: '#6B7280' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 10, color, fontWeight: 600, marginTop: 3, letterSpacing: '0.06em' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* MISSING entries — dead buttons requiring handler wiring */}
        {missingInteractions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', marginBottom: 8, letterSpacing: '0.06em' }}>
              ❌ MISSING — {missingInteractions.length} interactions with no handler wired
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {missingInteractions.map(a => (
                <div key={a.id} style={{
                  background: '#111118', border: '1px solid rgba(239,68,68,0.2)',
                  borderLeft: '3px solid #EF4444', borderRadius: 7, padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B7280' }}>{a.id}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', flex: 1 }}>{a.label}</span>
                    <span style={{ fontSize: 11, color: '#4B5563' }}>{a.component}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginBottom: a.fixHint ? 5 : 0 }}>{a.evidence}</div>
                  {a.fixHint && (
                    <div style={{ fontSize: 11, color: '#FCA5A5', background: 'rgba(239,68,68,0.06)', padding: '5px 8px', borderRadius: 4 }}>
                      <strong style={{ color: '#EF4444' }}>Fix: </strong>{a.fixHint}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GATED entries — require BACKEND_INTEGRATION=true */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8B5CF6', marginBottom: 8, letterSpacing: '0.06em' }}>
            🚩 GATED — {gatedInteractions.length} require BACKEND_INTEGRATION=true
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {gatedInteractions.map(a => (
              <span
                key={a.id}
                title={a.label}
                style={{
                  fontSize: 11, fontFamily: 'monospace',
                  background: 'rgba(139,92,246,0.08)', color: '#A78BFA',
                  padding: '3px 8px', borderRadius: 4,
                }}
              >
                {a.id}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 2: Manifest Node Status ──────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
          Manifest Node Status — click to expand
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          {statusOrder.map(status => {
            const c = STATUS_COLORS[status];
            const count = byManifestStatus[status].length;
            const isSelected = selectedManifestStatus === status;
            return (
              <div
                key={status}
                onClick={() => setSelectedManifestStatus(isSelected ? null : status)}
                style={{
                  background: isSelected ? c.bg : '#111118',
                  border: `2px solid ${isSelected ? c.dot : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 10, padding: '14px 18px', cursor: 'pointer',
                  minWidth: 100, textAlign: 'center', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 26, fontWeight: 800, color: c.dot }}>{count}</div>
                <div style={{ fontSize: 11, color: c.text, fontWeight: 600, marginTop: 4, letterSpacing: '0.06em' }}>{status}</div>
              </div>
            );
          })}
        </div>

        {selectedManifestStatus && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLORS[selectedManifestStatus].text, marginBottom: 10, letterSpacing: '0.06em' }}>
              {selectedManifestStatus} nodes ({byManifestStatus[selectedManifestStatus].length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {byManifestStatus[selectedManifestStatus].map(entry => (
                <div key={entry.id} style={{
                  padding: '10px 14px', borderRadius: 7,
                  background: '#111118', border: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6B7280' }}>{entry.id}</span>
                  <TypeBadge type={entry.type} />
                  <span style={{ fontSize: 13, color: '#E5E7EB', flex: 1 }}>{entry.name}</span>
                  <span style={{ fontSize: 11, color: '#4B5563' }}>{entry.domain}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#F59E0B', marginBottom: 10, letterSpacing: '0.06em' }}>
            ⚠ Nodes with attention notes ({nodesWithNotes.length})
          </div>
          {nodesWithNotes.length === 0 && (
            <div style={{ color: '#4B5563', fontSize: 13 }}>No notes — manifest is clean.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nodesWithNotes.map(entry => (
              <div key={entry.id} style={{
                background: '#111118', border: '1px solid rgba(245,158,11,0.2)',
                borderLeft: '3px solid #F59E0B', borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8B5CF6' }}>{entry.id}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB' }}>{entry.name}</span>
                  <StatusBadge status={entry.status} />
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#FCD34D', lineHeight: 1.6 }}>{entry.notes}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function RegistryViewer() {
  const [activeTab, setActiveTab] = useState<TabId>('registry');
  const allNodes = manifest.nodes;
  const totalNodes = Object.keys(allNodes).length;

  const tabContent: Record<TabId, React.ReactNode> = {
    registry:     <RegistryTab     allNodes={allNodes} />,
    validation:   <ValidationTab   allNodes={allNodes} />,
    stats:        <StatsTab        allNodes={allNodes} />,
    dependencies: <DependenciesTab allNodes={allNodes} />,
    processes:    <ProcessesTab    allNodes={allNodes} />,
    interactions: <InteractionsTab allNodes={allNodes} />,
    audit:        <AuditTab        allNodes={allNodes} />,
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0A0A0F',
      color: '#E5E7EB',
      fontFamily: 'Inter, -apple-system, sans-serif',
      padding: '0 0 64px',
    }}>
      {/* Header */}
      <div style={{
        background: '#0D0D16',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '20px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14,
            }}>⬡</div>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#F9FAFB' }}>MARQ Cortex</span>
            <span style={{ fontSize: 12, color: '#4B5563' }}>/ System Registry</span>
          </div>
          <div style={{ fontSize: 12, color: '#4B5563' }}>
            {totalNodes} verified nodes · v{manifest.version} · Last verified {manifest.lastVerified}
          </div>
        </div>
        <div style={{
          padding: '6px 14px', borderRadius: 6,
          background: manifest.backendIntegration ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
          border: `1px solid ${manifest.backendIntegration ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
          color: manifest.backendIntegration ? '#10B981' : '#F59E0B',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
        }}>
          {manifest.backendIntegration ? '● LIVE' : '◎ DEMO MODE'}
        </div>
      </div>

      {/* Core rule banner */}
      <div style={{
        background: 'rgba(139,92,246,0.06)',
        borderBottom: '1px solid rgba(139,92,246,0.15)',
        padding: '8px 32px',
        fontSize: 11, color: '#7C3AED', fontStyle: 'italic', textAlign: 'center',
      }}>
        "{manifest.coreRule}"
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 32px', overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '14px 18px', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
              color: activeTab === tab.id ? '#A78BFA' : '#6B7280',
              borderBottom: `2px solid ${activeTab === tab.id ? '#8B5CF6' : 'transparent'}`,
              whiteSpace: 'nowrap', transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
        {tabContent[activeTab]}
      </div>
    </div>
  );
}

export default RegistryViewer;