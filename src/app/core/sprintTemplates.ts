/**
 * CORTEX CORE — SPRINT TEMPLATES
 *
 * Static JSON templates for each sprint type.
 * Later: swap static JSON → API response.
 *
 * DO NOT hardcode text into components. Bind everything to data objects.
 */

import type { SprintTemplate, SprintTemplateId } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SPRINT TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const TEMPLATES: Record<SprintTemplateId, SprintTemplate> = {

  'automation-sprint': {
    id: 'automation-sprint',
    title: 'Automation Sprint',
    subtitle: 'Eliminate manual bottlenecks and recover capacity',
    coreProblemLabel: 'Manual Process Dependency',
    focusAreas: [
      'Map top 5 highest-volume manual workflows',
      'Deploy workflow automation for repetitive tasks',
      'Integrate data handoffs between systems',
      'Build real-time operational dashboard',
    ],
    phases: [
      {
        name: 'Discovery & Mapping',
        durationLabel: 'Days 1–10',
        objectives: ['Map current manual processes end-to-end', 'Quantify time waste per workflow', 'Identify automation-ready candidates'],
        deliverables: ['Process map document', 'Time-waste audit report', 'Automation candidate matrix'],
      },
      {
        name: 'Build & Automate',
        durationLabel: 'Days 11–25',
        objectives: ['Build and test automated workflows', 'Integrate key system connections', 'Deploy monitoring dashboards'],
        deliverables: ['Live automated workflows', 'System integration connectors', 'Operations dashboard'],
      },
      {
        name: 'Optimize & Handoff',
        durationLabel: 'Days 26–30',
        objectives: ['Validate automation accuracy', 'Train team on new workflows', 'Set up ongoing KPI tracking'],
        deliverables: ['Training documentation', 'KPI tracking system', 'Post-sprint optimization plan'],
      },
    ],
    kpiTemplates: [
      { metric: 'Hours saved per week', baselineHint: 'Current manual hours', target30Formula: '30% reduction', target60Formula: '55% reduction', target90Formula: '75% reduction', measurementMethod: 'Time tracking comparison' },
      { metric: 'Error rate', baselineHint: 'Current error %', target30Formula: '40% fewer errors', target60Formula: '65% fewer errors', target90Formula: '85% fewer errors', measurementMethod: 'Quality audit logs' },
      { metric: 'Process cycle time', baselineHint: 'Avg completion time', target30Formula: '25% faster', target60Formula: '45% faster', target90Formula: '60% faster', measurementMethod: 'Workflow analytics' },
    ],
    riskTemplates: [
      { risk: 'Team resistance to new workflows', probability: 'medium', impact: 'medium', mitigation: 'Involve team in design, run parallel for 2 weeks' },
      { risk: 'Integration complexity higher than estimated', probability: 'medium', impact: 'high', mitigation: 'API-first approach, modular integration layers' },
      { risk: 'Data quality issues block automation', probability: 'low', impact: 'high', mitigation: 'Data cleanup sprint in Phase 1' },
    ],
    baseInvestment: { lowMultiplier: 10000, highMultiplier: 25000 },
  },

  'inventory-sync-sprint': {
    id: 'inventory-sync-sprint',
    title: 'Inventory Sync Sprint',
    subtitle: 'Unify inventory across channels and eliminate overselling',
    coreProblemLabel: 'Inventory Chaos',
    focusAreas: [
      'Centralize inventory data into single source of truth',
      'Set up real-time sync across all sales channels',
      'Automate reorder triggers and stock alerts',
      'Build inventory accuracy dashboard',
    ],
    phases: [
      {
        name: 'Audit & Architecture',
        durationLabel: 'Days 1–8',
        objectives: ['Audit all inventory sources and channels', 'Design unified data model', 'Select integration architecture'],
        deliverables: ['Channel inventory map', 'Data architecture document', 'Integration plan'],
      },
      {
        name: 'Integration & Sync',
        durationLabel: 'Days 9–22',
        objectives: ['Connect all channels to central system', 'Configure real-time sync rules', 'Build automated reorder logic'],
        deliverables: ['Live multi-channel sync', 'Reorder automation', 'Stock alert system'],
      },
      {
        name: 'Validation & Scale',
        durationLabel: 'Days 23–30',
        objectives: ['Validate accuracy across all channels', 'Stress-test with volume scenarios', 'Train team on new system'],
        deliverables: ['Accuracy report', 'Stress test results', 'Training documentation'],
      },
    ],
    kpiTemplates: [
      { metric: 'Oversell incidents', baselineHint: 'Monthly oversells', target30Formula: '80% reduction', target60Formula: '95% reduction', target90Formula: 'Near zero', measurementMethod: 'Order exception reports' },
      { metric: 'Inventory accuracy', baselineHint: 'Current accuracy %', target30Formula: '95% accuracy', target60Formula: '98% accuracy', target90Formula: '99%+ accuracy', measurementMethod: 'Periodic physical count reconciliation' },
      { metric: 'Stock-out frequency', baselineHint: 'Monthly stockouts', target30Formula: '50% reduction', target60Formula: '75% reduction', target90Formula: '90% reduction', measurementMethod: 'Reorder alert logs' },
    ],
    riskTemplates: [
      { risk: 'Channel API limitations', probability: 'medium', impact: 'high', mitigation: 'Middleware layer for API normalization' },
      { risk: 'Legacy data migration errors', probability: 'high', impact: 'medium', mitigation: 'Parallel run with manual verification for 2 weeks' },
    ],
    baseInvestment: { lowMultiplier: 12000, highMultiplier: 30000 },
  },

  'retention-sprint': {
    id: 'retention-sprint',
    title: 'Revenue & Retention Sprint',
    subtitle: 'Stop revenue leakage and build systematic retention',
    coreProblemLabel: 'Revenue Leakage',
    focusAreas: [
      'Map full customer lifecycle (acquisition → retention → expansion)',
      'Identify and plug top revenue leakage points',
      'Build automated retention triggers (churn prediction, re-engagement)',
      'Deploy customer health scoring',
    ],
    phases: [
      {
        name: 'Revenue Leak Audit',
        durationLabel: 'Days 1–10',
        objectives: ['Map customer lifecycle end-to-end', 'Quantify revenue leakage per stage', 'Identify top 3 churn triggers'],
        deliverables: ['Lifecycle map', 'Leakage quantification report', 'Churn trigger analysis'],
      },
      {
        name: 'Retention Automation',
        durationLabel: 'Days 11–25',
        objectives: ['Build automated retention workflows', 'Deploy churn prediction signals', 'Create re-engagement campaigns'],
        deliverables: ['Retention automation workflows', 'Health scoring system', 'Re-engagement campaign templates'],
      },
      {
        name: 'Measurement & Expansion',
        durationLabel: 'Days 26–30',
        objectives: ['Validate retention impact', 'Identify expansion opportunities', 'Build upsell/cross-sell triggers'],
        deliverables: ['Retention impact report', 'Expansion playbook', 'Upsell automation'],
      },
    ],
    kpiTemplates: [
      { metric: 'Monthly churn rate', baselineHint: 'Current churn %', target30Formula: '15% improvement', target60Formula: '30% improvement', target90Formula: '45% improvement', measurementMethod: 'Cohort analysis' },
      { metric: 'Customer lifetime value', baselineHint: 'Current CLV', target30Formula: '10% increase', target60Formula: '20% increase', target90Formula: '35% increase', measurementMethod: 'Revenue attribution' },
      { metric: 'Revenue leakage recovered', baselineHint: 'Estimated monthly leakage', target30Formula: '25% recovered', target60Formula: '50% recovered', target90Formula: '70% recovered', measurementMethod: 'Before/after revenue comparison' },
    ],
    riskTemplates: [
      { risk: 'Insufficient historical data for prediction', probability: 'medium', impact: 'medium', mitigation: 'Rule-based triggers first, ML-based later' },
      { risk: 'Customer communication fatigue', probability: 'low', impact: 'medium', mitigation: 'Frequency caps and preference management' },
    ],
    baseInvestment: { lowMultiplier: 12000, highMultiplier: 28000 },
  },

  'systems-integration-sprint': {
    id: 'systems-integration-sprint',
    title: 'Systems Integration Sprint',
    subtitle: 'Connect fragmented tools into a unified operational layer',
    coreProblemLabel: 'Tool & System Fragmentation',
    focusAreas: [
      'Audit all tools and identify integration gaps',
      'Build middleware/API layer connecting core systems',
      'Eliminate duplicate data entry points',
      'Deploy unified operational dashboard',
    ],
    phases: [
      {
        name: 'Tool Audit & Architecture',
        durationLabel: 'Days 1–10',
        objectives: ['Catalog all tools and data flows', 'Identify critical integration gaps', 'Design integration architecture'],
        deliverables: ['Tool ecosystem map', 'Integration gap analysis', 'Architecture document'],
      },
      {
        name: 'Connect & Unify',
        durationLabel: 'Days 11–25',
        objectives: ['Build core integrations', 'Eliminate duplicate data entry', 'Deploy unified data layer'],
        deliverables: ['Live integrations', 'Data unification layer', 'Operational dashboard'],
      },
      {
        name: 'Validate & Optimize',
        durationLabel: 'Days 26–30',
        objectives: ['Validate data consistency', 'Optimize sync performance', 'Train team on unified view'],
        deliverables: ['Data consistency report', 'Performance benchmarks', 'Training documentation'],
      },
    ],
    kpiTemplates: [
      { metric: 'Manual data entry hours', baselineHint: 'Weekly manual hours', target30Formula: '50% reduction', target60Formula: '75% reduction', target90Formula: '90% reduction', measurementMethod: 'Time tracking' },
      { metric: 'Data discrepancies', baselineHint: 'Monthly discrepancies', target30Formula: '60% reduction', target60Formula: '85% reduction', target90Formula: '95% reduction', measurementMethod: 'Reconciliation reports' },
      { metric: 'Cross-system query time', baselineHint: 'Time to get answer', target30Formula: '< 5 minutes', target60Formula: '< 2 minutes', target90Formula: 'Real-time', measurementMethod: 'Dashboard load metrics' },
    ],
    riskTemplates: [
      { risk: 'Vendor API rate limits or changes', probability: 'medium', impact: 'high', mitigation: 'Caching layer and webhook-first architecture' },
      { risk: 'Data normalization complexity', probability: 'high', impact: 'medium', mitigation: 'Incremental normalization, start with most critical fields' },
    ],
    baseInvestment: { lowMultiplier: 15000, highMultiplier: 35000 },
  },

  'founder-leverage-sprint': {
    id: 'founder-leverage-sprint',
    title: 'Founder Leverage Sprint',
    subtitle: 'Eliminate decision bottlenecks and distribute authority',
    coreProblemLabel: 'Decision-Making Bottleneck',
    focusAreas: [
      'Map all decisions currently requiring founder approval',
      'Build decision authority matrix (what can be delegated)',
      'Automate approval workflows for routine decisions',
      'Create operating playbooks for common scenarios',
    ],
    phases: [
      {
        name: 'Decision Mapping',
        durationLabel: 'Days 1–10',
        objectives: ['Catalog all founder-dependent decisions', 'Classify by risk level and frequency', 'Design delegation framework'],
        deliverables: ['Decision dependency map', 'Risk classification matrix', 'Delegation framework'],
      },
      {
        name: 'Automation & Delegation',
        durationLabel: 'Days 11–25',
        objectives: ['Automate routine approval workflows', 'Build operating playbooks', 'Train team on decision authority'],
        deliverables: ['Automated approval workflows', 'Operating playbooks', 'Decision authority matrix'],
      },
      {
        name: 'Validate & Embed',
        durationLabel: 'Days 26–30',
        objectives: ['Monitor decision quality without founder', 'Adjust delegation boundaries', 'Build escalation protocols'],
        deliverables: ['Decision quality report', 'Adjusted delegation matrix', 'Escalation protocols'],
      },
    ],
    kpiTemplates: [
      { metric: 'Founder hours on routine decisions', baselineHint: 'Weekly hours', target30Formula: '40% reduction', target60Formula: '65% reduction', target90Formula: '80% reduction', measurementMethod: 'Calendar/time audit' },
      { metric: 'Decision cycle time', baselineHint: 'Avg approval time', target30Formula: '50% faster', target60Formula: '70% faster', target90Formula: 'Same-day for 90%', measurementMethod: 'Workflow analytics' },
      { metric: 'Team-autonomous decisions', baselineHint: '% without founder', target30Formula: '40% autonomous', target60Formula: '60% autonomous', target90Formula: '80% autonomous', measurementMethod: 'Decision log tracking' },
    ],
    riskTemplates: [
      { risk: 'Founder reluctance to delegate', probability: 'high', impact: 'high', mitigation: 'Start with low-risk decisions, build trust incrementally' },
      { risk: 'Decision quality drops initially', probability: 'medium', impact: 'medium', mitigation: 'Review cadence for first 30 days, gradual expansion' },
    ],
    baseInvestment: { lowMultiplier: 8000, highMultiplier: 20000 },
  },

  'data-unification-sprint': {
    id: 'data-unification-sprint',
    title: 'Data Unification Sprint',
    subtitle: 'Build a single source of truth for operational decisions',
    coreProblemLabel: 'Data Visibility Gap',
    focusAreas: [
      'Identify all data sources and their current state',
      'Build unified data layer with reconciliation rules',
      'Deploy operational intelligence dashboard',
      'Automate reporting and alerting',
    ],
    phases: [
      {
        name: 'Data Audit',
        durationLabel: 'Days 1–10',
        objectives: ['Catalog all data sources', 'Identify conflicts and gaps', 'Define single-source-of-truth rules'],
        deliverables: ['Data source inventory', 'Conflict analysis', 'Truth rules document'],
      },
      {
        name: 'Unification Build',
        durationLabel: 'Days 11–25',
        objectives: ['Build unified data layer', 'Connect all sources', 'Deploy dashboards and alerts'],
        deliverables: ['Unified data store', 'Live dashboards', 'Automated alerts'],
      },
      {
        name: 'Validation & Training',
        durationLabel: 'Days 26–30',
        objectives: ['Validate data accuracy', 'Train team on dashboards', 'Establish data governance'],
        deliverables: ['Accuracy validation report', 'Training materials', 'Data governance SOP'],
      },
    ],
    kpiTemplates: [
      { metric: 'Reporting time', baselineHint: 'Time to generate report', target30Formula: '70% faster', target60Formula: '90% faster', target90Formula: 'Real-time', measurementMethod: 'Report generation logs' },
      { metric: 'Data accuracy', baselineHint: 'Current accuracy %', target30Formula: '95% accurate', target60Formula: '98% accurate', target90Formula: '99%+ accurate', measurementMethod: 'Periodic reconciliation' },
      { metric: 'Decisions with data backing', baselineHint: '% data-driven decisions', target30Formula: '60%', target60Formula: '80%', target90Formula: '95%', measurementMethod: 'Decision log audit' },
    ],
    riskTemplates: [
      { risk: 'Historical data quality too poor to migrate', probability: 'medium', impact: 'medium', mitigation: 'Forward-looking data collection, archive legacy' },
      { risk: 'Stakeholder disagreement on truth rules', probability: 'medium', impact: 'high', mitigation: 'Executive sponsor designates authority per data domain' },
    ],
    baseInvestment: { lowMultiplier: 12000, highMultiplier: 28000 },
  },

  'lifecycle-optimization-sprint': {
    id: 'lifecycle-optimization-sprint',
    title: 'Lifecycle Optimization Sprint',
    subtitle: 'Build systematic customer journey management',
    coreProblemLabel: 'Customer Experience Breakdown',
    focusAreas: [
      'Map complete customer journey (awareness → advocacy)',
      'Identify friction points and drop-off stages',
      'Automate key touchpoints (onboarding, support, follow-up)',
      'Build customer satisfaction feedback loop',
    ],
    phases: [
      {
        name: 'Journey Mapping',
        durationLabel: 'Days 1–10',
        objectives: ['Map customer journey end-to-end', 'Quantify drop-off at each stage', 'Identify top 3 friction points'],
        deliverables: ['Customer journey map', 'Drop-off analysis', 'Friction point priority list'],
      },
      {
        name: 'Automation & Fix',
        durationLabel: 'Days 11–25',
        objectives: ['Automate critical touchpoints', 'Fix top friction points', 'Deploy satisfaction tracking'],
        deliverables: ['Touchpoint automations', 'UX improvements', 'CSAT/NPS system'],
      },
      {
        name: 'Measure & Iterate',
        durationLabel: 'Days 26–30',
        objectives: ['Measure impact on conversion and retention', 'Identify next optimization wave', 'Build continuous improvement cadence'],
        deliverables: ['Impact report', 'Next-wave roadmap', 'Improvement cadence SOP'],
      },
    ],
    kpiTemplates: [
      { metric: 'Customer satisfaction (CSAT)', baselineHint: 'Current CSAT', target30Formula: '10% improvement', target60Formula: '20% improvement', target90Formula: '30% improvement', measurementMethod: 'Post-interaction surveys' },
      { metric: 'Onboarding completion rate', baselineHint: 'Current %', target30Formula: '15% increase', target60Formula: '30% increase', target90Formula: '45% increase', measurementMethod: 'Funnel analytics' },
      { metric: 'Support ticket volume', baselineHint: 'Monthly tickets', target30Formula: '20% reduction', target60Formula: '40% reduction', target90Formula: '55% reduction', measurementMethod: 'Helpdesk analytics' },
    ],
    riskTemplates: [
      { risk: 'Incomplete customer data for journey analysis', probability: 'medium', impact: 'medium', mitigation: 'Start with available data, enrich progressively' },
      { risk: 'Cross-team coordination challenges', probability: 'medium', impact: 'medium', mitigation: 'Dedicated project owner with cross-functional authority' },
    ],
    baseInvestment: { lowMultiplier: 10000, highMultiplier: 22000 },
  },

  'compliance-sprint': {
    id: 'compliance-sprint',
    title: 'Compliance & Governance Sprint',
    subtitle: 'Build systematic compliance processes and risk management',
    coreProblemLabel: 'Compliance & Data Governance Gap',
    focusAreas: [
      'Audit current compliance posture and gaps',
      'Build automated compliance monitoring',
      'Create documentation and audit trail systems',
      'Deploy risk alerting and escalation protocols',
    ],
    phases: [
      {
        name: 'Compliance Audit',
        durationLabel: 'Days 1–10',
        objectives: ['Map regulatory requirements', 'Audit current compliance gaps', 'Prioritize remediation items'],
        deliverables: ['Compliance gap analysis', 'Risk register', 'Remediation priority list'],
      },
      {
        name: 'Remediation & Automation',
        durationLabel: 'Days 11–25',
        objectives: ['Fix critical compliance gaps', 'Automate monitoring and alerting', 'Build audit trail systems'],
        deliverables: ['Compliance fixes', 'Automated monitoring', 'Audit trail system'],
      },
      {
        name: 'Verification & Training',
        durationLabel: 'Days 26–30',
        objectives: ['Verify all gaps addressed', 'Train team on compliance protocols', 'Establish ongoing review cadence'],
        deliverables: ['Verification report', 'Training materials', 'Review cadence SOP'],
      },
    ],
    kpiTemplates: [
      { metric: 'Compliance gap count', baselineHint: 'Current gaps', target30Formula: '50% resolved', target60Formula: '80% resolved', target90Formula: '95% resolved', measurementMethod: 'Gap tracking system' },
      { metric: 'Audit readiness score', baselineHint: 'Current readiness', target30Formula: '70% ready', target60Formula: '90% ready', target90Formula: '99% ready', measurementMethod: 'Internal audit simulation' },
      { metric: 'Policy documentation coverage', baselineHint: 'Current coverage %', target30Formula: '60% documented', target60Formula: '85% documented', target90Formula: '100% documented', measurementMethod: 'Documentation inventory' },
    ],
    riskTemplates: [
      { risk: 'Regulatory requirements change during sprint', probability: 'low', impact: 'high', mitigation: 'Modular policy framework, easy to update' },
      { risk: 'Legacy processes resistant to standardization', probability: 'medium', impact: 'medium', mitigation: 'Phased rollout, start with new processes' },
    ],
    baseInvestment: { lowMultiplier: 15000, highMultiplier: 35000 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export function getSprintTemplate(id: SprintTemplateId): SprintTemplate {
  return TEMPLATES[id];
}

export function getAllSprintTemplates(): Record<SprintTemplateId, SprintTemplate> {
  return TEMPLATES;
}
