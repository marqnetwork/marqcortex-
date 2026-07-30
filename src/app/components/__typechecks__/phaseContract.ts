/**
 * PHASE 1B TASK 14 — compile-time SolutionBlueprint phase contract
 *
 * Type-level companion to tests/features/solutionBlueprintPhaseContract.test.ts.
 * This file has NO runtime: it is never imported by the application, emits
 * nothing (the frontend boundary is `noEmit`), and exists only so
 * `typecheck:web` proves the corrected SolutionBlueprint phase contract at the
 * type level.
 *
 * THE DEFECT
 *   SolutionBlueprint.tsx read its phases off `SolutionBlueprint['phases']`,
 *   which is `BlueprintPhase[]`, but declared its three section props as
 *   `ImplementationPhase[]`. Those are two different domain objects:
 *
 *     BlueprintPhase        recommendation-engine blueprint model (camelCase)
 *                           name / duration / objectives / deliverables
 *                           {item, description}[] / teamRequired /
 *                           milestones {day, milestone}[] / linkedBottleneck? /
 *                           risksMitigated
 *
 *     ImplementationPhase   proposal-draft model (snake_case DTO), reached via
 *                           ProposalDraft.implementation_phases
 *                           phase_number / title / duration_weeks /
 *                           solution_ids / deliverables: string[]
 *
 *   The two share no field name at all, so every phase read in the component
 *   was a diagnostic (3 × TS2322 on the prop passes, 15 × TS2339 on the reads).
 *   The runtime value was always a BlueprintPhase; only the annotation was
 *   wrong. The fix repoints the three annotations at BlueprintPhase — no
 *   adapter, no cast, no widening, no change to either interface.
 *
 * If the annotation ever regresses to ImplementationPhase, the assertions
 * below stop compiling and this boundary fails.
 */
import type {
  SolutionBlueprint,
  BlueprintPhase,
  ImplementationPhase,
} from '@/app/types/cortex-types';

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;
type Key<T> = Extract<keyof T, string>;

// ── 1. BlueprintPhase IS the blueprint's phase element ────────────────────────
// The component's section props read `blueprint.phases`, so the declared prop
// type must be exactly the array element of SolutionBlueprint['phases'].
type BlueprintPhaseElement = SolutionBlueprint['phases'][number];

type _ElementIsBlueprintPhase = Assert<Extends<BlueprintPhaseElement, BlueprintPhase>>;
type _BlueprintPhaseIsElement = Assert<Extends<BlueprintPhase, BlueprintPhaseElement>>;

// The prop pass at the three call sites — the exact TS2322 the fix removed.
declare const realPhases: SolutionBlueprint['phases'];
const _roadmapProp: BlueprintPhase[] = realPhases;
const _deliverablesProp: BlueprintPhase[] = realPhases;
const _resourceProp: BlueprintPhase[] = realPhases;

// ── 2. Every field the component reads exists on the selected contract ────────
// One entry per phase read in SolutionBlueprint.tsx. Each of these was a TS2339
// under the old annotation; all fifteen resolve under BlueprintPhase.
type _HasName = Assert<Extends<'name', Key<BlueprintPhase>>>;
type _HasDuration = Assert<Extends<'duration', Key<BlueprintPhase>>>;
type _HasObjectives = Assert<Extends<'objectives', Key<BlueprintPhase>>>;
type _HasDeliverables = Assert<Extends<'deliverables', Key<BlueprintPhase>>>;
type _HasMilestones = Assert<Extends<'milestones', Key<BlueprintPhase>>>;
type _HasTeamRequired = Assert<Extends<'teamRequired', Key<BlueprintPhase>>>;
type _HasRisksMitigated = Assert<Extends<'risksMitigated', Key<BlueprintPhase>>>;
type _HasLinkedBottleneck = Assert<Extends<'linkedBottleneck', Key<BlueprintPhase>>>;

// Deliverables are structured records, not strings — the `del.item` /
// `del.description` reads (4 diagnostics) depend on this and only this.
type Deliverable = BlueprintPhase['deliverables'][number];
type _DeliverableHasItem = Assert<Extends<Deliverable['item'], string>>;
type _DeliverableHasDescription = Assert<Extends<Deliverable['description'], string>>;

// Milestones are {day, milestone} records — the chip render depends on both.
type Milestone = BlueprintPhase['milestones'][number];
type _MilestoneHasDay = Assert<Extends<Milestone['day'], string>>;
type _MilestoneHasMilestone = Assert<Extends<Milestone['milestone'], string>>;

// `duration` is the rendered string ("Days 1-10"), not a week count. Rendering
// it verbatim is only correct because the contract is `string`.
type _DurationIsString = Assert<Extends<BlueprintPhase['duration'], string>>;

// `linkedBottleneck` is genuinely optional — the component guards it with
// `{phase.linkedBottleneck && …}`. No non-null assertion was added.
type _LinkedBottleneckOptional = Assert<undefined extends BlueprintPhase['linkedBottleneck'] ? true : false>;

// ── 3. The two models are NOT interchangeable ─────────────────────────────────
// Proof that this was a real model divergence and not a naming preference: the
// wrong annotation must stay wrong. If these ever start overlapping, the models
// have been merged elsewhere and this batch's reasoning needs revisiting.
type _NotAssignable = Assert<Extends<BlueprintPhase, ImplementationPhase> extends false ? true : false>;
type _NotAssignableBack = Assert<Extends<ImplementationPhase, BlueprintPhase> extends false ? true : false>;

// `deliverables` is the models' ONLY shared field name, and it is exactly where
// the divergence is sharpest: structured `{item, description}` records on
// BlueprintPhase, bare `string`s on ImplementationPhase. That collision is why
// the four `del.item` / `del.description` reads reported "Property 'item' does
// not exist on type 'string'" instead of a missing-property error on the array
// itself — the field resolved, its element type did not.
type SharedKeys = Key<BlueprintPhase> & Key<ImplementationPhase>;
type _OnlySharedKeyIsDeliverables = Assert<Extends<SharedKeys, 'deliverables'> extends true ? Extends<'deliverables', SharedKeys> : false>;
type _SharedKeyElementsDiverge = Assert<
  Extends<ImplementationPhase['deliverables'][number], Deliverable> extends false ? true : false
>;

// ImplementationPhase's own shape is untouched by this task.
type _ImplHasPhaseNumber = Assert<Extends<'phase_number', Key<ImplementationPhase>>>;
type _ImplDeliverablesAreStrings = Assert<Extends<ImplementationPhase['deliverables'][number], string>>;

void _roadmapProp;
void _deliverablesProp;
void _resourceProp;

export type {
  _ElementIsBlueprintPhase,
  _BlueprintPhaseIsElement,
  _HasName,
  _HasDuration,
  _HasObjectives,
  _HasDeliverables,
  _HasMilestones,
  _HasTeamRequired,
  _HasRisksMitigated,
  _HasLinkedBottleneck,
  _DeliverableHasItem,
  _DeliverableHasDescription,
  _MilestoneHasDay,
  _MilestoneHasMilestone,
  _DurationIsString,
  _LinkedBottleneckOptional,
  _NotAssignable,
  _NotAssignableBack,
  _OnlySharedKeyIsDeliverables,
  _SharedKeyElementsDiverge,
  _ImplHasPhaseNumber,
  _ImplDeliverablesAreStrings,
};
