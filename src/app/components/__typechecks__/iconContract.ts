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
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Zap, Shield, Target, TrendingUp, DollarSign,
  CheckCircle2, Search, FileText, Calendar,
  Sparkles, AlertCircle, Phone, MessageSquare, Info, ArrowRight,
} from 'lucide-react';
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

/**
 * PHASE 1B TASK 13 — remaining frontend icon contracts
 *
 * Same root cause, three more icon holders (ScenarioPanel `SCENARIO_CFG.Icon`,
 * SolutionArchitectureCard `LeverBar` `Icon` prop, StageTracker `STAGES[].icon`).
 * All three were declared className-only and all three are rendered with
 * `className` AND `style`, producing four TS2322s.
 *
 * None of the three holder types is exported — they are module-private object
 * literals and inline prop types — so, exactly as Task 11 handled ArchLayer /
 * RuleCard, the *declarations* are pinned structurally by
 * tests/features/frontendIconContracts.test.ts, while the *contract itself*
 * (real icon values in, real render props accepted) is proven here at the type
 * level against the corrected `LucideIcon` type the declarations now name.
 */

// The narrow contract these three fields used to declare.
type NarrowIconContract = { className?: string };

// Why it was wrong: it has no `style` key, so every render site passing a
// colour was an excess property (TS2322). LucideIcon does accept `style`.
type _NarrowLacksStyle = Assert<'style' extends keyof NarrowIconContract ? false : true>;
type _LucideAcceptsStyle = Assert<'style' extends keyof ComponentProps<LucideIcon> ? true : false>;

// Every icon actually assigned to the three corrected fields is a genuine
// lucide-react icon, so LucideIcon is accurate — not merely wider.
const _scenarioPanelIcons: LucideIcon[] = [Shield, Target, Zap];
const _leverBarIcons: LucideIcon[] = [Zap, TrendingUp, DollarSign, Shield];
const _stageTrackerIcons: LucideIcon[] = [CheckCircle2, Search, FileText, Calendar];

// The exact prop sets the four repaired render sites pass. Each of these is a
// diagnostic under the old narrow contract and compiles under the corrected one.
const _scenarioPanelRender: ComponentProps<LucideIcon> = {
  className: 'size-6',
  style: { color: '#06D7F6' },
};
const _leverBarRender: ComponentProps<LucideIcon> = {
  className: 'size-2.5',
  style: { color: '#10B981' },
};
const _stageTrackerPendingRender: ComponentProps<LucideIcon> = {
  className: 'size-5',
  style: { color: 'rgba(255,255,255,0.2)' },
};
const _stageTrackerRowRender: ComponentProps<LucideIcon> = {
  className: 'size-4',
  style: { color: '#06D7F6' },
};

void _scenarioPanelIcons;
void _leverBarIcons;
void _stageTrackerIcons;
void _scenarioPanelRender;
void _leverBarRender;
void _stageTrackerPendingRender;
void _stageTrackerRowRender;

export type { _NarrowLacksStyle, _LucideAcceptsStyle };

/**
 * PHASE 1B TASK 15 — GlobalAIChat icon contract
 *
 * The same family (a local icon contract narrower than the real lucide values)
 * but a DIFFERENT mechanism, which this section pins so the two are not
 * conflated. GlobalAIChat declared one module-private alias
 *
 *     type IconComponent = (props: { className?: string }) => React.ReactElement | null
 *
 * used by both icon holders (`SECTIONS[].icon` and `QuickAction.icon`), and all
 * 24 of the file's diagnostics were lucide icons assigned to those two fields.
 *
 * Unlike Tasks 11/13 the fault was NOT the prop side: both render sites pass
 * `className` only, which the old alias accepted. The fault was the RETURN type
 * — a lucide icon's call signature returns `ReactNode`, which is wider than
 * `ReactElement | null`, so the assignment failed on return-type compatibility
 * ("Type 'ReactNode' is not assignable to type 'ReactElement'"). Both fields now
 * name `LucideIcon` directly and the inaccurate alias is gone.
 */

// The exact alias GlobalAIChat used to declare, reproduced verbatim so the
// proof below is about the real fault rather than a paraphrase of it.
type StaleIconComponent = (props: { className?: string }) => ReactElement | null;

// `ReactNode` is a union, so the distributive `Extends` above would collapse it
// to `boolean`. This form keeps the comparison whole-union, as assignability is.
type ExtendsExact<A, B> = [A] extends [B] ? true : false;

// The fault: a real lucide icon does NOT satisfy the stale alias …
type _LucideIsNotStaleIcon = Assert<Extends<LucideIcon, StaleIconComponent> extends false ? true : false>;
// … and the reason is the return type, not the props.
type _ReactNodeIsWiderThanElement = Assert<ExtendsExact<ReactNode, ReactElement | null> extends false ? true : false>;

// Proof the prop side was never the problem here: the stale alias already
// accepted the only prop either render site passes. That is why this batch
// changes no JSX — there is no missing `style` to restore, unlike Tasks 11/13.
const _staleAcceptedClassName: Parameters<StaleIconComponent>[0] = { className: 'size-3' };
const _globalAIChatRender: ComponentProps<LucideIcon> = { className: 'size-3' };

// Every icon assigned to the two corrected fields is a genuine lucide-react
// icon, so LucideIcon is accurate — not merely wider. Six for SECTIONS[].icon,
// and the distinct set used across the eighteen SECTION_QUICK_ACTIONS entries.
const _globalAIChatSectionIcons: LucideIcon[] = [
  Sparkles, FileText, AlertCircle, Target, DollarSign, Phone,
];
const _globalAIChatQuickActionIcons: LucideIcon[] = [
  Sparkles, Zap, MessageSquare, AlertCircle, Info, ArrowRight,
];

void _staleAcceptedClassName;
void _globalAIChatRender;
void _globalAIChatSectionIcons;
void _globalAIChatQuickActionIcons;

export type { _LucideIsNotStaleIcon, _ReactNodeIsWiderThanElement };
