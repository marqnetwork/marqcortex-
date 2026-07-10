/**
 * REVENUE INTELLIGENCE DASHBOARD AGGREGATOR — Phase 8
 *
 * Spec: dashboard-specs.md
 * Governance: Math decides every metric. No estimations from narrative.
 *
 * Architecture note (spec §3):
 *   In production → nightly aggregation job writes pre-computed rows to
 *   dashboard_aggregate table from crm_deals / proposal_state / roi_actuals / roi_variance.
 *   In mock-first mode → all aggregation runs deterministically from MOCK_SNAPSHOTS.
 *
 * Exports:
 *   MOCK_SNAPSHOTS: DealSnapshot[]
 *   filterSnapshots(snapshots, filters)
 *   aggregateRevenue(snapshots)         → RevenuePanelData
 *   aggregateProposalPerf(snapshots)    → ProposalPerfData
 *   aggregateROIAccuracy(snapshots)     → ROIAccuracyData
 *   aggregateObjections(snapshots)      → ObjectionIntelData
 *   buildKPIStrip(current, prev)        → KPITile[]
 */

import type { CRMStage, ObjectionType } from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// DEAL SNAPSHOT — flattened record, one row per deal
// This is what the nightly aggregation job would materialize.
// ════════════════════════════════════════════════════════════════════════════════

export interface DealSnapshot {
  deal_id:     string;
  client_name: string;
  industry:    string;
  region:      'NA' | 'EMEA' | 'APAC';
  owner:       string;
  stage:       CRMStage;
  value:       number;
  deal_size_band: '$0–50K' | '$50K–100K' | '$100K+';
  scenario:    'conservative' | 'expected' | 'optimistic';

  // Spec §2: Derived from crm_deals + proposal_state
  created_at:           string;   // ISO YYYY-MM-DD
  proposal_sent_at:     string | null;
  proposal_viewed_at:   string | null;
  proposal_approved_at: string | null;
  contract_signed_at:   string | null;

  // Spec §4: Derived from objection_detected
  objection_type:          ObjectionType | null;
  objection_resolved_days: number | null;   // null = unresolved / in-progress
  is_expired:              boolean;

  // Spec §3: Derived from roi_actuals + roi_variance
  projected_roi_pct:       number;
  actual_roi_pct:          number | null;   // null if no actuals yet
  projected_payback_month: number;
  actual_payback_month:    number | null;
}

// ════════════════════════════════════════════════════════════════════════════════
// DATE HELPERS — fixed reference: 2026-03-02
// ════════════════════════════════════════════════════════════════════════════════

const REF = new Date('2026-03-02T00:00:00.000Z');

function dba(days: number): string {
  const d = new Date(REF);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK SNAPSHOTS — 16 seeded deals across all pipeline stages / industries
// ════════════════════════════════════════════════════════════════════════════════

export const MOCK_SNAPSHOTS: DealSnapshot[] = [
  {
    deal_id: 'D-001', client_name: 'ExampleCo',
    industry: 'Finance',       region: 'NA',   owner: 'Sarah Chen',
    stage: 'proposal_viewed',  value: 95_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(14), proposal_sent_at: dba(7), proposal_viewed_at: dba(5),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'trust', objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 285, actual_roi_pct: null, projected_payback_month: 8, actual_payback_month: null,
  },
  {
    deal_id: 'D-002', client_name: 'BuildRight Ltd',
    industry: 'Construction',  region: 'NA',   owner: 'Mike Ross',
    stage: 'proposal_sent',    value: 47_000, deal_size_band: '$0–50K',   scenario: 'conservative',
    created_at: dba(14), proposal_sent_at: dba(3), proposal_viewed_at: null,
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 210, actual_roi_pct: null, projected_payback_month: 12, actual_payback_month: null,
  },
  {
    deal_id: 'D-003', client_name: 'Meridian Health',
    industry: 'Healthcare',    region: 'NA',   owner: 'Sarah Chen',
    stage: 'contract_signed',  value: 120_000, deal_size_band: '$100K+',  scenario: 'expected',
    created_at: dba(55), proposal_sent_at: dba(45), proposal_viewed_at: dba(43),
    proposal_approved_at: dba(38), contract_signed_at: dba(30),
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 340, actual_roi_pct: 315, projected_payback_month: 8, actual_payback_month: 9,
  },
  {
    deal_id: 'D-004', client_name: 'TechNova Corp',
    industry: 'Technology',    region: 'APAC', owner: 'James Park',
    stage: 'closed_won',       value: 180_000, deal_size_band: '$100K+',  scenario: 'optimistic',
    created_at: dba(90), proposal_sent_at: dba(80), proposal_viewed_at: dba(78),
    proposal_approved_at: dba(70), contract_signed_at: dba(60),
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 420, actual_roi_pct: 390, projected_payback_month: 6, actual_payback_month: 7,
  },
  {
    deal_id: 'D-005', client_name: 'Nexus Retail',
    industry: 'Retail',        region: 'EMEA', owner: 'Mike Ross',
    stage: 'closed_won',       value: 65_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(40), proposal_sent_at: dba(35), proposal_viewed_at: dba(32),
    proposal_approved_at: dba(28), contract_signed_at: dba(20),
    objection_type: 'price', objection_resolved_days: 5, is_expired: false,
    projected_roi_pct: 195, actual_roi_pct: 188, projected_payback_month: 10, actual_payback_month: 11,
  },
  {
    deal_id: 'D-006', client_name: 'Atlas Logistics',
    industry: 'Logistics',     region: 'NA',   owner: 'Sarah Chen',
    stage: 'negotiation_objection', value: 38_000, deal_size_band: '$0–50K', scenario: 'conservative',
    created_at: dba(25), proposal_sent_at: dba(12), proposal_viewed_at: dba(10),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'price', objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 175, actual_roi_pct: null, projected_payback_month: 11, actual_payback_month: null,
  },
  {
    deal_id: 'D-007', client_name: 'Stellar Media',
    industry: 'Media',         region: 'EMEA', owner: 'James Park',
    stage: 'closed_lost',      value: 55_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(75), proposal_sent_at: dba(65), proposal_viewed_at: dba(62),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'timing', objection_resolved_days: 20, is_expired: false,
    projected_roi_pct: 260, actual_roi_pct: null, projected_payback_month: 8, actual_payback_month: null,
  },
  {
    deal_id: 'D-008', client_name: 'Quantum Finance',
    industry: 'Finance',       region: 'NA',   owner: 'Mike Ross',
    stage: 'proposal_draft',   value: 210_000, deal_size_band: '$100K+',  scenario: 'optimistic',
    created_at: dba(20), proposal_sent_at: null, proposal_viewed_at: null,
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 380, actual_roi_pct: null, projected_payback_month: 6, actual_payback_month: null,
  },
  {
    deal_id: 'D-009', client_name: 'Bloom Education',
    industry: 'Education',     region: 'NA',   owner: 'Sarah Chen',
    stage: 'onboarding_started', value: 32_000, deal_size_band: '$0–50K', scenario: 'conservative',
    created_at: dba(65), proposal_sent_at: dba(55), proposal_viewed_at: dba(52),
    proposal_approved_at: dba(48), contract_signed_at: dba(40),
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 165, actual_roi_pct: 142, projected_payback_month: 11, actual_payback_month: 13,
  },
  {
    deal_id: 'D-010', client_name: 'Carbon Systems',
    industry: 'Manufacturing', region: 'APAC', owner: 'James Park',
    stage: 'implementation_active', value: 145_000, deal_size_band: '$100K+', scenario: 'expected',
    created_at: dba(100), proposal_sent_at: dba(90), proposal_viewed_at: dba(87),
    proposal_approved_at: dba(80), contract_signed_at: dba(72),
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 310, actual_roi_pct: 289, projected_payback_month: 7, actual_payback_month: 8,
  },
  {
    deal_id: 'D-011', client_name: 'Apex Consulting',
    industry: 'Consulting',    region: 'NA',   owner: 'Sarah Chen',
    stage: 'closed_won',       value: 88_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(80), proposal_sent_at: dba(70), proposal_viewed_at: dba(66),
    proposal_approved_at: dba(60), contract_signed_at: dba(55),
    objection_type: 'internal_alignment', objection_resolved_days: 6, is_expired: false,
    projected_roi_pct: 295, actual_roi_pct: 310, projected_payback_month: 8, actual_payback_month: 7,
  },
  {
    deal_id: 'D-012', client_name: 'FlowTech SaaS',
    industry: 'Technology',    region: 'NA',   owner: 'James Park',
    stage: 'proposal_sent',    value: 72_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(12), proposal_sent_at: dba(5), proposal_viewed_at: null,
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 245, actual_roi_pct: null, projected_payback_month: 9, actual_payback_month: null,
  },
  {
    deal_id: 'D-013', client_name: 'Veritas Legal',
    industry: 'Legal',         region: 'EMEA', owner: 'Mike Ross',
    stage: 'proposal_viewed',  value: 95_000, deal_size_band: '$50K–100K', scenario: 'conservative',
    created_at: dba(18), proposal_sent_at: dba(9), proposal_viewed_at: dba(6),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'risk', objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 220, actual_roi_pct: null, projected_payback_month: 10, actual_payback_month: null,
  },
  {
    deal_id: 'D-014', client_name: 'NovaCare Health',
    industry: 'Healthcare',    region: 'NA',   owner: 'Sarah Chen',
    stage: 'closed_lost',      value: 155_000, deal_size_band: '$100K+',  scenario: 'optimistic',
    created_at: dba(60), proposal_sent_at: dba(50), proposal_viewed_at: dba(47),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'price', objection_resolved_days: 15, is_expired: false,
    projected_roi_pct: 295, actual_roi_pct: null, projected_payback_month: 7, actual_payback_month: null,
  },
  {
    deal_id: 'D-015', client_name: 'Prism Analytics',
    industry: 'Analytics',     region: 'NA',   owner: 'James Park',
    stage: 'closed_won',       value: 67_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: dba(95), proposal_sent_at: dba(85), proposal_viewed_at: dba(82),
    proposal_approved_at: dba(75), contract_signed_at: dba(65),
    objection_type: 'risk', objection_resolved_days: 5, is_expired: false,
    projected_roi_pct: 230, actual_roi_pct: 215, projected_payback_month: 9, actual_payback_month: 10,
  },
  {
    deal_id: 'D-016', client_name: 'Summit Group',
    industry: 'Consulting',    region: 'EMEA', owner: 'Mike Ross',
    stage: 'closed_lost',      value: 43_000, deal_size_band: '$0–50K',   scenario: 'conservative',
    created_at: dba(82), proposal_sent_at: dba(75), proposal_viewed_at: dba(71),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: 'price', objection_resolved_days: 15, is_expired: true,
    projected_roi_pct: 185, actual_roi_pct: null, projected_payback_month: 12, actual_payback_month: null,
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// FILTER TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface DashboardFilters {
  dateRange:    'last_30' | 'last_90' | 'last_6mo' | 'all';
  industry:     string;     // 'all' or specific industry name
  owner:        string;     // 'all' or name
  region:       string;     // 'all' | 'NA' | 'EMEA' | 'APAC'
  scenario:     string;     // 'all' | 'conservative' | 'expected' | 'optimistic'
  dealSizeBand: string;     // 'all' | '$0–50K' | '$50K–100K' | '$100K+'
}

export const DEFAULT_FILTERS: DashboardFilters = {
  dateRange:    'last_90',
  industry:     'all',
  owner:        'all',
  region:       'all',
  scenario:     'all',
  dealSizeBand: 'all',
};

// ════════════════════════════════════════════════════════════════════════════════
// FILTER FUNCTION
// ════════════════════════════════════════════════════════════════════════════════

function cutoffDays(range: DashboardFilters['dateRange']): number {
  return range === 'last_30' ? 30 : range === 'last_90' ? 90 : range === 'last_6mo' ? 180 : 9999;
}

export function filterSnapshots(
  snapshots: DealSnapshot[],
  filters:   DashboardFilters,
): DealSnapshot[] {
  const cutoff    = cutoffDays(filters.dateRange);
  const cutoffISO = dba(cutoff);

  return snapshots.filter(s => {
    if (s.created_at < cutoffISO)                                   return false;
    if (filters.industry    !== 'all' && s.industry    !== filters.industry)    return false;
    if (filters.owner       !== 'all' && s.owner       !== filters.owner)       return false;
    if (filters.region      !== 'all' && s.region      !== filters.region)      return false;
    if (filters.scenario    !== 'all' && s.scenario    !== filters.scenario)    return false;
    if (filters.dealSizeBand !== 'all' && s.deal_size_band !== filters.dealSizeBand) return false;
    return true;
  });
}

/** Previous period snapshot for MoM comparison */
export function prevPeriodSnapshots(
  snapshots: DealSnapshot[],
  filters:   DashboardFilters,
): DealSnapshot[] {
  if (filters.dateRange === 'all') return [];
  const days     = cutoffDays(filters.dateRange);
  const fromISO  = dba(days * 2);
  const toISO    = dba(days);

  return snapshots.filter(s => {
    if (s.created_at < fromISO || s.created_at >= toISO) return false;
    if (filters.industry    !== 'all' && s.industry    !== filters.industry)    return false;
    if (filters.owner       !== 'all' && s.owner       !== filters.owner)       return false;
    if (filters.region      !== 'all' && s.region      !== filters.region)      return false;
    if (filters.scenario    !== 'all' && s.scenario    !== filters.scenario)    return false;
    if (filters.dealSizeBand !== 'all' && s.deal_size_band !== filters.dealSizeBand) return false;
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// STAGE GROUPS — for Revenue Panel pipeline funnel
// ════════════════════════════════════════════════════════════════════════════════

const WON_STAGES: CRMStage[] = [
  'contract_signed', 'onboarding_started', 'implementation_active', 'closed_won',
];

const CLOSED_STAGES: CRMStage[] = ['closed_won', 'closed_lost'];

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 1 — REVENUE PERFORMANCE
// ════════════════════════════════════════════════════════════════════════════════

export interface StageBar {
  stage:  string;
  deals:  number;
  value:  number;
}

export interface RevenuePanelData {
  total_deals:        number;
  proposals_sent:     number;
  close_rate_pct:     number;
  closed_won_value:   number;
  avg_deal_size:      number;
  avg_sales_cycle_days: number | null;
  pipeline_funnel:    StageBar[];
}

export function aggregateRevenue(snapshots: DealSnapshot[]): RevenuePanelData {
  const sent    = snapshots.filter(s => s.proposal_sent_at !== null);
  const won     = snapshots.filter(s => WON_STAGES.includes(s.stage));
  const wonOnly = snapshots.filter(s => s.stage === 'closed_won');

  const closeRate = sent.length > 0 ? (won.length / sent.length) * 100 : 0;
  const closedWonVal = wonOnly.reduce((sum, s) => sum + s.value, 0);
  const avgDealSize  = snapshots.length > 0
    ? snapshots.reduce((sum, s) => sum + s.value, 0) / snapshots.length
    : 0;

  // Sales cycle: avg(signed - sent) days for won deals with both dates
  const cycles = won
    .filter(s => s.contract_signed_at && s.proposal_sent_at)
    .map(s => {
      const diff = new Date(s.contract_signed_at!).getTime() - new Date(s.proposal_sent_at!).getTime();
      return diff / 86_400_000;
    });
  const avgCycle = cycles.length > 0
    ? cycles.reduce((a, b) => a + b, 0) / cycles.length
    : null;

  // Funnel groups
  const groups: { label: string; stages: CRMStage[] }[] = [
    { label: 'Diagnostic',  stages: ['lead_captured', 'diagnostic_started', 'diagnostic_completed'] },
    { label: 'Proposal',    stages: ['proposal_draft', 'proposal_sent', 'proposal_viewed'] },
    { label: 'Negotiation', stages: ['negotiation_objection', 'approved_pending_contract'] },
    { label: 'Contract',    stages: ['contract_sent', 'contract_signed'] },
    { label: 'Delivery',    stages: ['onboarding_started', 'implementation_active'] },
    { label: 'Closed Won',  stages: ['closed_won'] },
    { label: 'Closed Lost', stages: ['closed_lost'] },
  ];

  const pipeline_funnel: StageBar[] = groups.map(g => {
    const deals = snapshots.filter(s => g.stages.includes(s.stage));
    return {
      stage: g.label,
      deals: deals.length,
      value: deals.reduce((sum, s) => sum + s.value, 0),
    };
  });

  return {
    total_deals:           snapshots.length,
    proposals_sent:        sent.length,
    close_rate_pct:        Math.round(closeRate * 10) / 10,
    closed_won_value:      closedWonVal,
    avg_deal_size:         Math.round(avgDealSize),
    avg_sales_cycle_days:  avgCycle !== null ? Math.round(avgCycle * 10) / 10 : null,
    pipeline_funnel,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 2 — PROPOSAL PERFORMANCE
// ════════════════════════════════════════════════════════════════════════════════

export interface ConversionStep {
  label:   string;
  count:   number;
  pct:     number;   // % of sent
}

export interface ProposalPerfData {
  view_rate_pct:            number;
  approval_rate_pct:        number;
  avg_time_to_view_hours:   number | null;
  expiration_rate_pct:      number;
  objection_rate_pct:       number;
  conversion_funnel:        ConversionStep[];
  objection_by_industry:    { industry: string; rate: number }[];
}

export function aggregateProposalPerf(snapshots: DealSnapshot[]): ProposalPerfData {
  const sent     = snapshots.filter(s => s.proposal_sent_at !== null);
  const viewed   = snapshots.filter(s => s.proposal_viewed_at !== null);
  const approved = snapshots.filter(s => s.proposal_approved_at !== null);
  const signed   = snapshots.filter(s => s.contract_signed_at !== null);
  const expired  = snapshots.filter(s => s.is_expired);
  const objected = snapshots.filter(s => s.objection_type !== null);

  const n = sent.length;

  const viewRate     = n > 0 ? (viewed.length / n) * 100 : 0;
  const approvalRate = viewed.length > 0 ? (approved.length / viewed.length) * 100 : 0;
  const expirationRate = n > 0 ? (expired.length / n) * 100 : 0;
  const objectionRate  = n > 0 ? (objected.length / n) * 100 : 0;

  // Avg time to first view (sent → viewed) in hours
  const viewTimes = viewed
    .filter(s => s.proposal_sent_at)
    .map(s => {
      const diff = new Date(s.proposal_viewed_at!).getTime() - new Date(s.proposal_sent_at!).getTime();
      return diff / 3_600_000;
    });
  const avgViewTime = viewTimes.length > 0
    ? viewTimes.reduce((a, b) => a + b, 0) / viewTimes.length
    : null;

  const conversion_funnel: ConversionStep[] = [
    { label: 'Sent',     count: sent.length,     pct: 100 },
    { label: 'Viewed',   count: viewed.length,   pct: n > 0 ? Math.round(viewRate)     : 0 },
    { label: 'Approved', count: approved.length, pct: n > 0 ? Math.round((approved.length / n) * 100) : 0 },
    { label: 'Signed',   count: signed.length,   pct: n > 0 ? Math.round((signed.length / n) * 100)   : 0 },
  ];

  // Objection rate by industry
  const industries = [...new Set(snapshots.map(s => s.industry))];
  const objection_by_industry = industries.map(ind => {
    const indSent     = sent.filter(s => s.industry === ind);
    const indObjected = objected.filter(s => s.industry === ind);
    return {
      industry: ind,
      rate:     indSent.length > 0 ? Math.round((indObjected.length / indSent.length) * 100) : 0,
    };
  }).sort((a, b) => b.rate - a.rate);

  return {
    view_rate_pct:          Math.round(viewRate * 10) / 10,
    approval_rate_pct:      Math.round(approvalRate * 10) / 10,
    avg_time_to_view_hours: avgViewTime !== null ? Math.round(avgViewTime) : null,
    expiration_rate_pct:    Math.round(expirationRate * 10) / 10,
    objection_rate_pct:     Math.round(objectionRate * 10) / 10,
    conversion_funnel,
    objection_by_industry,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 3 — ROI ACCURACY
// ════════════════════════════════════════════════════════════════════════════════

export interface IndustryAccuracyRow {
  industry:          string;
  projected_roi:     number;
  actual_roi:        number;
  accuracy_pct:      number;
  deal_count:        number;
}

export interface ROIAccuracyData {
  avg_projected_roi_pct:    number;
  avg_actual_roi_pct:       number;
  forecast_accuracy_pct:    number;
  avg_payback_deviation_mo: number;
  tracked_deals:            number;
  industry_breakdown:       IndustryAccuracyRow[];
}

export function aggregateROIAccuracy(snapshots: DealSnapshot[]): ROIAccuracyData {
  const tracked = snapshots.filter(s => s.actual_roi_pct !== null);

  if (tracked.length === 0) {
    return {
      avg_projected_roi_pct:    0,
      avg_actual_roi_pct:       0,
      forecast_accuracy_pct:    0,
      avg_payback_deviation_mo: 0,
      tracked_deals:            0,
      industry_breakdown:       [],
    };
  }

  const avgProj  = tracked.reduce((s, d) => s + d.projected_roi_pct,              0) / tracked.length;
  const avgAct   = tracked.reduce((s, d) => s + (d.actual_roi_pct ?? 0),          0) / tracked.length;
  const accuracy = avgProj > 0 ? (avgAct / avgProj) * 100 : 0;

  const pbDeviations = tracked
    .filter(d => d.actual_payback_month !== null)
    .map(d => (d.actual_payback_month ?? 0) - d.projected_payback_month);
  const avgPBDev = pbDeviations.length > 0
    ? pbDeviations.reduce((a, b) => a + b, 0) / pbDeviations.length
    : 0;

  const industries = [...new Set(tracked.map(d => d.industry))];
  const industry_breakdown: IndustryAccuracyRow[] = industries.map(ind => {
    const group    = tracked.filter(d => d.industry === ind);
    const projAvg  = group.reduce((s, d) => s + d.projected_roi_pct, 0) / group.length;
    const actAvg   = group.reduce((s, d) => s + (d.actual_roi_pct ?? 0), 0) / group.length;
    return {
      industry:      ind,
      projected_roi: Math.round(projAvg),
      actual_roi:    Math.round(actAvg),
      accuracy_pct:  projAvg > 0 ? Math.round((actAvg / projAvg) * 100 * 10) / 10 : 0,
      deal_count:    group.length,
    };
  }).sort((a, b) => b.accuracy_pct - a.accuracy_pct);

  return {
    avg_projected_roi_pct:    Math.round(avgProj * 10) / 10,
    avg_actual_roi_pct:       Math.round(avgAct  * 10) / 10,
    forecast_accuracy_pct:    Math.round(accuracy * 10) / 10,
    avg_payback_deviation_mo: Math.round(avgPBDev * 10) / 10,
    tracked_deals:            tracked.length,
    industry_breakdown,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PANEL 4 — OBJECTION INTELLIGENCE
// ════════════════════════════════════════════════════════════════════════════════

export interface ObjectionTypeRow {
  type:             ObjectionType;
  label:            string;
  count:            number;
  frequency_pct:    number;
  close_rate_pct:   number | null;   // null if no closed deals with this type
  avg_resolve_days: number | null;
}

export interface ObjectionIntelData {
  total_with_objection:    number;
  objection_rate_pct:      number;
  price_objection_pct:     number;
  risk_objection_pct:      number;
  avg_resolve_days:        number | null;
  by_type:                 ObjectionTypeRow[];
}

const OBJECTION_LABELS: Record<ObjectionType, string> = {
  price:              'Price',
  risk:               'Risk',
  timing:             'Timing',
  trust:              'Trust',
  internal_alignment: 'Internal Alignment',
};

const ALL_OBJECTION_TYPES: ObjectionType[] = ['price', 'risk', 'timing', 'trust', 'internal_alignment'];

export function aggregateObjections(snapshots: DealSnapshot[]): ObjectionIntelData {
  const sent     = snapshots.filter(s => s.proposal_sent_at !== null);
  const objected = snapshots.filter(s => s.objection_type !== null);
  const total    = objected.length;

  const objRate  = sent.length > 0 ? (total / sent.length) * 100 : 0;

  const pricePct = total > 0
    ? (objected.filter(s => s.objection_type === 'price').length / total) * 100 : 0;
  const riskPct  = total > 0
    ? (objected.filter(s => s.objection_type === 'risk').length / total) * 100  : 0;

  // Avg resolve days across all resolved (includes lost deals)
  const resolved = objected.filter(s => s.objection_resolved_days !== null);
  const avgResolve = resolved.length > 0
    ? resolved.reduce((sum, s) => sum + (s.objection_resolved_days ?? 0), 0) / resolved.length
    : null;

  const by_type: ObjectionTypeRow[] = ALL_OBJECTION_TYPES.map(type => {
    const group  = objected.filter(s => s.objection_type === type);
    const closed = group.filter(s => CLOSED_STAGES.includes(s.stage));
    const won    = closed.filter(s => s.stage === 'closed_won');

    const closeRate = closed.length > 0
      ? Math.round((won.length / closed.length) * 100)
      : null;

    const resolveTimes = group.filter(s => s.objection_resolved_days !== null);
    const avgRes = resolveTimes.length > 0
      ? Math.round(resolveTimes.reduce((s, d) => s + (d.objection_resolved_days ?? 0), 0) / resolveTimes.length)
      : null;

    return {
      type,
      label:            OBJECTION_LABELS[type],
      count:            group.length,
      frequency_pct:    total > 0 ? Math.round((group.length / total) * 100) : 0,
      close_rate_pct:   closeRate,
      avg_resolve_days: avgRes,
    };
  }).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  return {
    total_with_objection: total,
    objection_rate_pct:   Math.round(objRate * 10) / 10,
    price_objection_pct:  Math.round(pricePct * 10) / 10,
    risk_objection_pct:   Math.round(riskPct  * 10) / 10,
    avg_resolve_days:     avgResolve !== null ? Math.round(avgResolve * 10) / 10 : null,
    by_type,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// LEADERSHIP KPI STRIP — spec §4
// 6 tiles: Close Rate, ROI Accuracy, Revenue Won, Avg Deal Size, Avg Sales Cycle, Objection Rate
// ════════════════════════════════════════════════════════════════════════════════

export interface KPITile {
  id:        string;
  label:     string;
  value:     string;
  raw:       number | null;
  delta_pct: number | null;   // vs previous period; null if no prev
  delta_abs: string | null;   // formatted absolute delta
  higher_is_better: boolean;
  unit:      string;
}

export function buildKPIStrip(
  curr: DealSnapshot[],
  prev: DealSnapshot[],
): KPITile[] {
  const cRev = aggregateRevenue(curr);
  const pRev = prev.length > 0 ? aggregateRevenue(prev) : null;

  const cROI = aggregateROIAccuracy(curr);
  const pROI = prev.length > 0 ? aggregateROIAccuracy(prev) : null;

  const cObj = aggregateObjections(curr);
  const pObj = prev.length > 0 ? aggregateObjections(prev) : null;

  function deltaPct(cur: number, pre: number | undefined | null): number | null {
    if (pre === undefined || pre === null || pre === 0) return null;
    return Math.round(((cur - pre) / Math.abs(pre)) * 1000) / 10;
  }

  function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }
  function fmtUSD(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  }

  const wonValue = curr.filter(s => s.stage === 'closed_won').reduce((s, d) => s + d.value, 0);
  const prevWonValue = prev.filter(s => s.stage === 'closed_won').reduce((s, d) => s + d.value, 0);

  return [
    {
      id:    'close_rate',
      label: 'Close Rate',
      value: fmtPct(cRev.close_rate_pct),
      raw:   cRev.close_rate_pct,
      delta_pct: deltaPct(cRev.close_rate_pct, pRev?.close_rate_pct),
      delta_abs: pRev ? `${(cRev.close_rate_pct - pRev.close_rate_pct).toFixed(1)}pp` : null,
      higher_is_better: true,
      unit: '%',
    },
    {
      id:    'roi_accuracy',
      label: 'ROI Accuracy',
      value: cROI.tracked_deals > 0 ? fmtPct(cROI.forecast_accuracy_pct) : 'N/A',
      raw:   cROI.forecast_accuracy_pct,
      delta_pct: deltaPct(cROI.forecast_accuracy_pct, pROI?.forecast_accuracy_pct),
      delta_abs: pROI ? `${(cROI.forecast_accuracy_pct - pROI.forecast_accuracy_pct).toFixed(1)}pp` : null,
      higher_is_better: true,
      unit: '%',
    },
    {
      id:    'revenue_won',
      label: 'Revenue Won',
      value: fmtUSD(wonValue),
      raw:   wonValue,
      delta_pct: deltaPct(wonValue, prevWonValue || null),
      delta_abs: prevWonValue ? fmtUSD(Math.abs(wonValue - prevWonValue)) : null,
      higher_is_better: true,
      unit: '$',
    },
    {
      id:    'avg_deal_size',
      label: 'Avg Deal Size',
      value: fmtUSD(cRev.avg_deal_size),
      raw:   cRev.avg_deal_size,
      delta_pct: deltaPct(cRev.avg_deal_size, pRev?.avg_deal_size),
      delta_abs: pRev ? fmtUSD(Math.abs(cRev.avg_deal_size - pRev.avg_deal_size)) : null,
      higher_is_better: true,
      unit: '$',
    },
    {
      id:    'sales_cycle',
      label: 'Avg Sales Cycle',
      value: cRev.avg_sales_cycle_days !== null ? `${cRev.avg_sales_cycle_days}d` : 'N/A',
      raw:   cRev.avg_sales_cycle_days,
      delta_pct: (cRev.avg_sales_cycle_days !== null && pRev?.avg_sales_cycle_days != null)
        ? deltaPct(cRev.avg_sales_cycle_days, pRev.avg_sales_cycle_days) : null,
      delta_abs: null,
      higher_is_better: false,   // lower is better
      unit: 'days',
    },
    {
      id:    'objection_rate',
      label: 'Objection Rate',
      value: fmtPct(cObj.objection_rate_pct),
      raw:   cObj.objection_rate_pct,
      delta_pct: deltaPct(cObj.objection_rate_pct, pObj?.objection_rate_pct),
      delta_abs: pObj ? `${(cObj.objection_rate_pct - pObj.objection_rate_pct).toFixed(1)}pp` : null,
      higher_is_better: false,   // lower is better
      unit: '%',
    },
  ];
}

// ════════════════════════════════════════════════════════════════════════════════
// FILTER OPTION DERIVERS — populate dropdowns from data
// ════════════════════════════════════════════════════════════════════════════════

export function deriveFilterOptions(snapshots: DealSnapshot[]) {
  return {
    industries: ['all', ...new Set(snapshots.map(s => s.industry))].sort(),
    owners:     ['all', ...new Set(snapshots.map(s => s.owner))].sort(),
    regions:    ['all', 'NA', 'EMEA', 'APAC'] as const,
    scenarios:  ['all', 'conservative', 'expected', 'optimistic'] as const,
    dealSizes:  ['all', '$0–50K', '$50K–100K', '$100K+'] as const,
    dateRanges: [
      { id: 'last_30',  label: 'Last 30 Days'   },
      { id: 'last_90',  label: 'Last 90 Days'   },
      { id: 'last_6mo', label: 'Last 6 Months'  },
      { id: 'all',      label: 'All Time'        },
    ],
  };
}
