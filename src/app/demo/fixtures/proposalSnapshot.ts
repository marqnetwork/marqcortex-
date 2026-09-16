/**
 * DEMO PROPOSAL SNAPSHOT — a $42,000 engagement that was never sold.
 *
 * Declared inline in `MappingEnginePanel.tsx` until CP-1, where it was not a
 * fallback but the panel's only input, in every configuration: the surface
 * displayed it as the proposal being mapped, ran the eight-step pipeline
 * against it, and presented the workstreams, milestones, tasks and governance
 * gates that came out as an execution plan.
 *
 * It is a good demonstration of a deterministic engine. It is not a client, a
 * price or a plan, and the panel no longer presents it as one.
 */

import type { ProposalSnapshot } from '@/app/core/snapshotEngine';
import { generateVersionHash } from '@/app/core/snapshotEngine';

export const DEMO_PROPOSAL_SNAPSHOT: ProposalSnapshot = {
  proposal_snapshot_id: 'PS-DEMO-001',
  proposal_id:          'PROP-EXCO-001',
  version_number:       1,
  version_hash:         generateVersionHash({ demo: true }),
  created_at:           new Date(Date.now() - 86400000 * 2).toISOString(),
  created_by:           'account-lead-01',
  status:               'immutable',
  triggered_by_export:  'pdf_export',
  content_snapshot: {
    blocks: [],
    roi_snapshot: {
      total_investment: 42000,
      monthly_cost_before: 31000,
      hours_wasted_monthly: 220,
      revenue_at_risk_annual: 312000,
      payback_months: 8,
      roi_percent_12m: 318,
    } as any,
    assumptions_snapshot: [],
    contract_snapshot: [],
    executive_brief: {
      client_name: 'ExampleCo',
      title: 'ExampleCo AI Operations Transformation',
      engagement_type: 'AI Operations Audit',
      value_prop: 'Eliminate 220 hrs/month of manual work and recover $312K annual revenue leakage through targeted automation.',
      key_outcomes: ['Automated order fulfillment pipeline', 'Real-time inventory sync', 'AI-powered customer support triage'],
      proposed_investment: '$42,000',
      proposed_timeline: '12 weeks',
    } as any,
    diagnosis_blocks: [
      { id: 'dx-01', title: 'Manual Order Processing', severity: 'critical', description: 'Team manually copies orders between 4 systems — 6 hrs/day.' } as any,
      { id: 'dx-02', title: 'Inventory Fragmentation', severity: 'high',     description: 'Stock levels not synced across channels — overselling 3-4x/week.' } as any,
    ],
    scope_boundaries: {
      included: [
        'Order management automation (WMS ↔ Shopify ↔ ERP)',
        'AI customer support triage + escalation routing',
        'Real-time inventory sync across all sales channels',
        'Executive KPI dashboard (live operational data)',
      ],
      scope_included: [],
      scope_excluded: ['Third-party tool procurement', 'Legal contract redlines', 'Non-digital change management'],
      integration_points: ['Shopify API', 'WMS REST API', 'Zendesk webhook', 'Google Data Studio'],
      assumptions: [
        'Client IT provides credentials within 5 business days of kickoff',
        'Existing CRM data is exportable (minimum CSV)',
        'Named client project owner available 4 hrs/week',
      ],
    } as any,
    next_step_offer: null as any,
    solutions: [
      { solution_id: 'sol-01', title: 'Automated Order Pipeline',    system_description: 'End-to-end order flow automation eliminating all manual touchpoints.',       timeline_weeks: 4, diagnosis_link: 'dx-01' },
      { solution_id: 'sol-02', title: 'Inventory Intelligence Sync', system_description: 'Real-time multi-channel inventory synchronisation with conflict resolution.',   timeline_weeks: 3, diagnosis_link: 'dx-02' },
      { solution_id: 'sol-03', title: 'AI Support Triage Engine',    system_description: 'ML classifier routes 60% of tickets automatically; escalates the rest.',       timeline_weeks: 3, diagnosis_link: 'dx-02' },
    ] as any,
    implementation_phases: [
      { phase_id: 'ph-01', phase_name: 'Audit & System Mapping', start_week: 1, end_week: 2,  duration: 'Weeks 1–2',   governance_checkpoint: 'Kickoff sign-off' },
      { phase_id: 'ph-02', phase_name: 'Build & Configure',      start_week: 3, end_week: 5,  duration: 'Weeks 3–5',   governance_checkpoint: 'Security & DPA gate' },
      { phase_id: 'ph-03', phase_name: 'Validate & Pilot',       start_week: 6, end_week: 8,  duration: 'Weeks 6–8',   governance_checkpoint: 'UAT sign-off' },
      { phase_id: 'ph-04', phase_name: 'Deploy & Review',        start_week: 9, end_week: 12, duration: 'Weeks 9–12',  governance_checkpoint: 'Executive go-live' },
    ] as any,
  },
};
