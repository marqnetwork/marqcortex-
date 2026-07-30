/**
 * PHASE 1B TASK 11 — compile-time icon contract
 *
 * Type-level companion to tests/features/frontendIconContracts.test.ts. This
 * file has NO runtime: it is never imported by the application, emits nothing
 * (the frontend boundary is `noEmit`), and exists only so `typecheck:web`
 * proves the corrected `PipelineColumnDef['Icon']` contract at the type level.
 *
 * If the field ever regresses to the old narrow `ComponentType<{ className?:
 * string }>`, the `_renderProps` assignment below stops compiling (style/size
 * become excess props) and this boundary fails — exactly the diagnostic Task 11
 * removed. PipelineColumnDef is the repo's only exported icon-holder type;
 * SystemArchitecture's ArchLayer / RuleCard contracts are module-private and
 * are covered structurally by the runtime regression test.
 */
import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Zap } from 'lucide-react';
import type { PipelineColumnDef } from '../PipelineKanban';

type ColumnIcon = PipelineColumnDef['Icon'];

// Compile-time mutual-assignability assertions (no casts, no `any`).
type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

// The column icon field IS the official LucideIcon contract, both directions.
type _ColumnIconIsLucide = Assert<Extends<ColumnIcon, LucideIcon>>;
type _LucideIsColumnIcon = Assert<Extends<LucideIcon, ColumnIcon>>;

// A real lucide-react icon is a valid runtime value for the field.
const _realIcon: ColumnIcon = Zap;

// The corrected contract accepts every prop the render sites actually pass —
// className AND style AND size — which the old className-only type rejected.
const _renderProps: ComponentProps<ColumnIcon> = {
  className: 'size-3.5 flex-shrink-0',
  style: { color: '#3B82F6' },
  size: 14,
};

void _realIcon;
void _renderProps;

export type { _ColumnIconIsLucide, _LucideIsColumnIcon };
