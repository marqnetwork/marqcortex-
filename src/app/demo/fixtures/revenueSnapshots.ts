/**
 * DEMO REVENUE SNAPSHOTS — sixteen invented deals.
 *
 * Lifted out of `@/app/core/dashboardAggregator`, which is a core module the
 * authenticated product imports for its aggregation functions. Keeping named
 * clients and a fabricated pipeline in there meant every revenue surface had
 * them in scope.
 *
 * The aggregators stayed. These are fixtures and they live behind the demo
 * boundary with the rest.
 */

import type { DealSnapshot } from '@/app/core/dashboardAggregator';

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
