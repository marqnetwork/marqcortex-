/**
 * PHASE 1B TASK 20 — compile-time contract for DiagnosticProposal.savedAt
 *
 * Type-level companion to tests/features/proposalSavedAtContract.test.ts. This
 * file has NO runtime: it is never imported by the application, emits nothing
 * (the frontend boundary is `noEmit`), and exists only so `typecheck:web`
 * proves the corrected `DiagnosticProposal['savedAt']` contract.
 *
 * The field must be OPTIONAL and a STRING. Both halves matter:
 *
 *   optional — a proposal built locally by `buildFromData()` has never been
 *              through the save route, so it carries no `savedAt`. Making the
 *              field required would make every locally-built proposal invalid.
 *   string   — the server stamps `new Date().toISOString()`, and the render
 *              site feeds the value straight into `new Date(...)`.
 */
import type { DiagnosticProposal } from '../../types/proposal';

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

// The field exists on the interface at all — the TS2339 Task 20 removed.
type _HasSavedAt = Assert<'savedAt' extends keyof DiagnosticProposal ? true : false>;

// It is optional: `undefined` is an accepted value for the property.
type _SavedAtIsOptional = Assert<Extends<undefined, DiagnosticProposal['savedAt']>>;

// And when present it is a string, which is what `new Date(...)` is given.
type _SavedAtIsString = Assert<Extends<NonNullable<DiagnosticProposal['savedAt']>, string>>;

// A proposal that has never been saved is still a valid DiagnosticProposal.
// This is the shape `buildFromData()` produces, reduced to the fields that
// matter for this contract; the omission of `savedAt` must not be an error.
type UnsavedProposalFields = Omit<DiagnosticProposal, 'savedAt'>;
type _UnsavedIsStillAProposal = Assert<
  Extends<UnsavedProposalFields & { savedAt?: undefined }, Omit<DiagnosticProposal, never>>
>;

// The value the save route returns is assignable to the field.
const _serverStamp: DiagnosticProposal['savedAt'] = new Date().toISOString();

// The render site's guarded read compiles and yields a string.
declare const _proposal: DiagnosticProposal;
const _renderedSavedAt: string = _proposal.savedAt ? new Date(_proposal.savedAt).toISOString() : '';

void _serverStamp;
void _renderedSavedAt;

export type {
  _HasSavedAt,
  _SavedAtIsOptional,
  _SavedAtIsString,
  _UnsavedIsStillAProposal,
};
