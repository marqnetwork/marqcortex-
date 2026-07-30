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

/**
 * PHASE 1B TASK 17 — the remaining className-only icon holders
 *
 * Twenty diagnostics across fifteen components, one root cause, mechanically
 * identical to Tasks 11 and 13: an icon holder declared `React.FC<{ className?:
 * string }>` (or the `React.ComponentType` spelling of the same shape) while its
 * render site passes `className` AND `style`. `style` was therefore an excess
 * property and the render was rejected (TS2322) even though it was always valid
 * at runtime.
 *
 * Every holder repaired in this task is module-private — object literals and
 * inline prop types, none exported — so, exactly as Tasks 11/13 handled ArchLayer
 * and RuleCard, the *declarations* are pinned structurally by
 * tests/features/frontendIconContracts.test.ts, while the *contract* is proven
 * here at the type level: the real icon values are assignable to `LucideIcon`,
 * and `LucideIcon` accepts every prop set the twenty repaired sites pass.
 */
import {
  Edit3, Expand, Minimize2, ShieldCheck, Printer, FileCheck2,
  Package, GitBranch, List, Layers, Database, Settings, Bot,
  TrendingDown, Users, AlertTriangle, TimerOff, Clock, Pen,
  FileBarChart2, UserCheck, Check, RefreshCw, Eye as EyeIcon,
} from 'lucide-react';

// The twenty repaired sites all pass a colour through `style`, which the narrow
// contract could not express. `_NarrowLacksStyle` / `_LucideAcceptsStyle` above
// already prove why; these pin the exact prop shapes Task 17 restored.
const _colourByLiteral: ComponentProps<LucideIcon> = {
  className: 'size-3.5',
  style: { color: '#8B5CF6' },
};
// MappingEnginePanel's stepper is the one conditional case: the style object is
// `{ color }` while the step is active and `{}` otherwise. The union has to be
// assignable too, or the repaired render would still not compile.
const _colourConditional: ComponentProps<LucideIcon> = {
  className: 'size-4 text-gray-600',
  style: (false as boolean) ? { color: '#06D7F6' } : {},
};

// Every value assigned to a repaired holder is a genuine lucide-react icon, so
// `LucideIcon` is the narrowest ACCURATE type — not merely a wider one. Grouped
// by the holder each set belongs to.
const _blockHistoryChangeIcons: LucideIcon[] = [Edit3, Zap, Expand, Minimize2, MessageSquare];
const _blockRegistrySectionIcons: LucideIcon[] = [ShieldCheck, CheckCircle2, Info];
const _engagementFeedIcons: LucideIcon[] = [EyeIcon, FileText, Zap, Printer, FileCheck2, Calendar, MessageSquare];
const _exportDocTypeIcons: LucideIcon[] = [FileBarChart2, FileText, Pen];
const _kanbanAlertIcons: LucideIcon[] = [TrendingDown, TrendingUp, Users, AlertTriangle, TimerOff];
const _implArchCheckpointIcons: LucideIcon[] = [CheckCircle2, UserCheck, Check, RefreshCw];
const _implArchIntegrationIcons: LucideIcon[] = [Layers, Database, Settings, Bot, Shield];
const _mappingStepIcons: LucideIcon[] = [Package, GitBranch, Calendar, List, Shield];
const _objectionIcons: LucideIcon[] = [DollarSign, Shield, Clock, EyeIcon, Users];

void _colourByLiteral;
void _colourConditional;
void _blockHistoryChangeIcons;
void _blockRegistrySectionIcons;
void _engagementFeedIcons;
void _exportDocTypeIcons;
void _kanbanAlertIcons;
void _implArchCheckpointIcons;
void _implArchIntegrationIcons;
void _mappingStepIcons;
void _objectionIcons;
