/**
 * PHASE 1B TASK 29 — compile-time contract for the outcome card's local state
 *
 * Type-level companion to tests/features/outcomeCardStateContract.test.ts. This
 * file has NO runtime: it is never imported by the application, emits nothing
 * (the frontend boundary is `noEmit`), and exists only so `typecheck:web` proves
 * the narrowed `OutcomeCardRecord` contract.
 *
 * `OutcomeModule` held its card state as the full server-hydrated
 * `OutcomeRecord`, which requires five submission-enrichment fields — industry,
 * company, aiScore, recommendedService, submittedAt — that only the backend can
 * supply. The demo-mode branch builds its record locally and has none of them,
 * so the literal raised TS2739.
 *
 * The fix declares the state as exactly what the card consumes: the outcome
 * payload plus the three stamps it reads back. Two properties must hold, and
 * both are asserted below:
 *
 *   narrower — the demo producer's object satisfies the contract without
 *              inventing enrichment values.
 *   compatible — a full `OutcomeRecord` from `getOutcome()` is still assignable,
 *              so the hydrated path is unaffected.
 *
 * No server contract was widened or weakened: `OutcomeRecord` and
 * `OutcomePayload` are imported here and only read.
 */
import type { OutcomeCardRecord } from '../CortexModulesNew';
import type { OutcomePayload, OutcomeRecord } from '../../services/dataService';

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

// ── The server record still flows into the card state ──────────────────────
// This is the `setExistingOutcome(o)` call in the hydration effect.
type _ServerRecordIsAssignable = Assert<Extends<OutcomeRecord, OutcomeCardRecord>>;

declare const _hydrated: OutcomeRecord;
const _fromApi: OutcomeCardRecord = _hydrated;

// ── The card state is strictly narrower than the server record ─────────────
// The enrichment fields are NOT part of the card contract, which is the whole
// point of the task: the demo producer cannot supply them.
type _CardIsNotTheServerRecord = Assert<Extends<OutcomeCardRecord, OutcomeRecord> extends true ? false : true>;

type EnrichmentField = 'industry' | 'company' | 'aiScore' | 'recommendedService' | 'submittedAt';
type _EnrichmentIsOnTheServerRecord = Assert<Extends<EnrichmentField, keyof OutcomeRecord>>;
type _EnrichmentIsNotRequiredByTheCard = Assert<
  Extends<EnrichmentField, keyof OutcomeCardRecord> extends true ? false : true
>;

// ── The payload half is carried verbatim ───────────────────────────────────
type _CardCarriesThePayload = Assert<Extends<OutcomeCardRecord, OutcomePayload>>;

// ── Every field the card reads is present on the contract ──────────────────
// `didConvert` and `loggedAt` are rendered; the rest hydrate the form controls.
type ConsumedField =
  | 'didConvert'
  | 'conversionValue'
  | 'lostReason'
  | 'recommendationWorked'
  | 'whatWeLearned'
  | 'improvementAreas'
  | 'submissionId'
  | 'loggedAt'
  | 'loggedBy';
type _CardExposesEveryConsumedField = Assert<Extends<ConsumedField, keyof OutcomeCardRecord>>;

// The two fields the JSX reads directly must have the types the render sites need.
declare const _card: OutcomeCardRecord;
const _renderedBadge: boolean = _card.didConvert;
const _renderedDate: string = new Date(_card.loggedAt).toLocaleDateString();

// ── The demo-mode producer satisfies the contract as written ────────────────
// Field-for-field the object built in the `!isBackendEnabled()` branch.
const _demoOutcome: OutcomeCardRecord = {
  submissionId: 'SUB-1',
  didConvert: true,
  conversionValue: 4200,
  lostReason: null,
  recommendationWorked: true,
  whatWeLearned: 'Faster follow-up closed the gap.',
  improvementAreas: ['response time'],
  loggedAt: new Date().toISOString(),
  loggedBy: 'demo-user',
};

void _fromApi;
void _renderedBadge;
void _renderedDate;
void _demoOutcome;

export type {
  _ServerRecordIsAssignable,
  _CardIsNotTheServerRecord,
  _EnrichmentIsOnTheServerRecord,
  _EnrichmentIsNotRequiredByTheCard,
  _CardCarriesThePayload,
  _CardExposesEveryConsumedField,
};
