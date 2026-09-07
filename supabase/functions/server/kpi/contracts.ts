/**
 * Enterprise KPIs — contracts. Blueprint §IV-48.
 *
 * §IV-48 fixes the KPI CATEGORIES and is explicit about what it does not fix:
 *
 * > **Scope.** KPI **categories only**. **No numeric targets, no thresholds, no
 * > formulas, no dashboards.** Every category is subordinate to trust and the
 * > constitutional success dimensions.
 *
 * and states the approved future state as "formal KPI definitions per category
 * with (LATER) concrete targets/SLOs".
 *
 * So this module is the definitions and the readings. There is no target, no
 * threshold and no grade anywhere in it, and there must not be one until
 * somebody decides the numbers — which §IV-48 puts in a later phase.
 *
 * ── THE ANTI-METRIC EXCLUSION IS STRUCTURAL, NOT A COMMENT ─────────────────
 *
 * §IV-48 says, binding: "No KPI category may reward feature count, novelty,
 * interface spectacle, engagement-for-its-own-sake, or short-term extraction."
 * DNA Ch 33.3 says the same of the enterprise.
 *
 * A rule stated only in prose is a rule the next indicator breaks. So the
 * registry enforces two things at registration:
 *
 *   EVERY INDICATOR MUST NAME AT LEAST ONE CONSTITUTIONAL SUCCESS DIMENSION it
 *   serves, from the nine in DNA Ch 33.2. An indicator that cannot say which
 *   dimension it serves is measuring activity for its own sake, and cannot be
 *   registered.
 *
 *   NO INDICATOR MAY BE NAMED FOR AN EXPLICIT NON-SUCCESS. The five in
 *   Ch 33.3 are refused by name.
 *
 * WHAT THAT CANNOT DO, STATED PLAINLY: a dishonest indicator can claim a
 * dimension it does not serve. The registry catches the careless case, not the
 * determined one — the determined one is caught in review, which is where
 * DNA Ch 33.3 puts it. Claiming otherwise would be the kind of false assurance
 * this file exists to prevent.
 */

/** The four categories §IV-48 fixes. Not extensible by configuration. */
export type KpiCategory = 'strategic' | 'operational' | 'quality' | 'customer';

export const KPI_CATEGORIES: readonly KpiCategory[] = [
  'strategic',
  'operational',
  'quality',
  'customer',
];

/**
 * The nine constitutional success dimensions, DNA Ch 33.2, verbatim in order.
 *
 * Copied as identifiers rather than paraphrased, so a reader can check this
 * list against the Constitution without interpreting anything.
 */
export type SuccessDimension =
  | 'outcome_delivery'
  | 'effortless_capability'
  | 'trust'
  | 'workforce_coherence'
  | 'simplicity_under_growth'
  | 'compounding_judgment'
  | 'integrity'
  | 'durability'
  | 'breadth';

export const SUCCESS_DIMENSIONS: readonly SuccessDimension[] = [
  'outcome_delivery',
  'effortless_capability',
  'trust',
  'workforce_coherence',
  'simplicity_under_growth',
  'compounding_judgment',
  'integrity',
  'durability',
  'breadth',
];

/**
 * What DNA Ch 33.3 says is explicitly NOT success.
 *
 * Refused by name at registration. A blunt gate, and a cheap one: it catches an
 * indicator somebody named honestly and did not think through.
 */
export const NON_SUCCESS_TERMS: readonly string[] = [
  'feature_count',
  'novelty',
  'spectacle',
  'engagement',
  'extraction',
];

/**
 * What a reading's number IS.
 *
 * Deliberately not "score" or "grade". A KPI in this phase reports a
 * measurement; nothing here converts one into a judgement.
 */
export type KpiUnit = 'count' | 'ratio_percent' | 'micro_usd' | 'milliseconds';

export interface KpiDefinition {
  /** `<category>.<indicator>`, lower snake case after the dot. */
  readonly id: string;
  readonly category: KpiCategory;
  /** A short human name. Never a sentence. */
  readonly name: string;
  /**
   * The question this indicator answers, as a question.
   *
   * Required, because an indicator whose question cannot be written down is an
   * indicator nobody can say the purpose of — which is how a metrics programme
   * accumulates numbers that reward activity.
   */
  readonly question: string;
  readonly unit: KpiUnit;
  /** At least one. See the module comment. */
  readonly serves: readonly SuccessDimension[];
}

export interface KpiReading {
  readonly id: string;
  readonly category: KpiCategory;
  readonly name: string;
  readonly unit: KpiUnit;
  readonly serves: readonly SuccessDimension[];
  /**
   * The measurement, or `null` when it could not be taken.
   *
   * `null` is not zero. A platform where nothing has happened and a platform
   * whose signal cannot be read are different states, and reporting both as `0`
   * is how a KPI report becomes reassuring at the exact moment it stops
   * working — the same discipline the operational health framework applies to
   * `unknown`.
   */
  readonly value: number | null;
  /** What the number was computed from, in one line. No tenant data. */
  readonly basis: string;
  readonly observedAt: string;
}

export interface KpiReport {
  readonly generatedAt: string;
  readonly readings: readonly KpiReading[];
  /** Indicators whose measurement could not be taken. Named, not inferred. */
  readonly unmeasured: readonly string[];
  /**
   * Restated on every report.
   *
   * A consumer that renders this alongside the numbers cannot quietly start
   * treating them as scored, and one that ignores it has been told.
   */
  readonly targetsInScope: false;
}

/** How a registered indicator is measured. A port; see `catalog.ts`. */
export interface KpiMeasurement {
  readonly id: string;
  measure(): Promise<{ value: number | null; basis: string }> | { value: number | null; basis: string };
}
