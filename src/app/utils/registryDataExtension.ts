/**
 * ============================================================================
 * MARQ CORTEX — REGISTRY EXTENSION  (MQC-REGISTRY v1.1)
 * ============================================================================
 * Adds all nodes missing from the v1.0 registry:
 *   • 48 individual shadcn/ui components
 *   • 2 protected system files
 *   • 4 CSS / style files
 *   • 4 infrastructure / build files
 *   • 6 documentation files
 *   • 60 import spec/schema/asset files
 *   • 16 individual backend functions (helpers + KV ops)
 *   • 6 missing API routes (learning-loop, pipeline, kanban capacity)
 *   • RegistryViewer itself (MQC-CMP-091)
 *   • API path corrections for blocks/* and ai/chat
 * ============================================================================
 */

import type { RegistryNode } from './registryData';

// ─── Extended node types used only in this extension ─────────────────────────
// (The RegistryViewer handles them via the EXTENDED_TYPE_META map below)

// ============================================================================
// N. INDIVIDUAL UI PRIMITIVES (shadcn/ui — one entry per file)
// ============================================================================

export const UI_INDIVIDUAL_NODES: RegistryNode[] = [
  // NOTE: chart.tsx is the ONE EXCEPTION that may use <> fragments.
  // ALL other ui/ components must use <span className="contents"> instead of <>.
  { id: 'MQC-UI-001', label: 'accordion.tsx',       path: '/src/app/components/ui/accordion.tsx',       type: 'UI', domain: 'ui-system', description: 'shadcn Accordion — collapsible section panels.',       demands: [], supplies: ['Accordion','AccordionItem','AccordionTrigger','AccordionContent'],    status: 'stable' },
  { id: 'MQC-UI-002', label: 'alert-dialog.tsx',    path: '/src/app/components/ui/alert-dialog.tsx',    type: 'UI', domain: 'ui-system', description: 'shadcn AlertDialog — accessible confirmation dialogs.', demands: [], supplies: ['AlertDialog','AlertDialogTrigger','AlertDialogContent','AlertDialogAction','AlertDialogCancel'], status: 'stable' },
  { id: 'MQC-UI-003', label: 'alert.tsx',           path: '/src/app/components/ui/alert.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Alert — status/info banner component.',          demands: [], supplies: ['Alert','AlertTitle','AlertDescription'],                               status: 'stable' },
  { id: 'MQC-UI-004', label: 'aspect-ratio.tsx',    path: '/src/app/components/ui/aspect-ratio.tsx',    type: 'UI', domain: 'ui-system', description: 'shadcn AspectRatio — enforces fixed w:h ratio.',         demands: [], supplies: ['AspectRatio'],                                                     status: 'stable' },
  { id: 'MQC-UI-005', label: 'avatar.tsx',          path: '/src/app/components/ui/avatar.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Avatar — user avatar with image/fallback.',       demands: [], supplies: ['Avatar','AvatarImage','AvatarFallback'],                            status: 'stable' },
  { id: 'MQC-UI-006', label: 'badge.tsx',           path: '/src/app/components/ui/badge.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Badge — inline status/label chip.',              demands: [], supplies: ['Badge','badgeVariants'],                                           status: 'stable' },
  { id: 'MQC-UI-007', label: 'breadcrumb.tsx',      path: '/src/app/components/ui/breadcrumb.tsx',      type: 'UI', domain: 'ui-system', description: 'shadcn Breadcrumb — navigation path trail.',            demands: [], supplies: ['Breadcrumb','BreadcrumbList','BreadcrumbItem','BreadcrumbLink','BreadcrumbSeparator'], status: 'stable' },
  { id: 'MQC-UI-008', label: 'button.tsx',          path: '/src/app/components/ui/button.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Button — primary interactive button with variants (default|destructive|outline|ghost|link).',  demands: [], supplies: ['Button','buttonVariants'],                     status: 'stable' },
  { id: 'MQC-UI-009', label: 'calendar.tsx',        path: '/src/app/components/ui/calendar.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Calendar — date-picker calendar widget.',         demands: [], supplies: ['Calendar'],                                                       status: 'stable' },
  { id: 'MQC-UI-010', label: 'card.tsx',            path: '/src/app/components/ui/card.tsx',            type: 'UI', domain: 'ui-system', description: 'shadcn Card — container card with header/content/footer.', demands: [], supplies: ['Card','CardHeader','CardTitle','CardDescription','CardContent','CardFooter'], status: 'stable' },
  { id: 'MQC-UI-011', label: 'carousel.tsx',        path: '/src/app/components/ui/carousel.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Carousel — embla-based carousel slider.',         demands: [], supplies: ['Carousel','CarouselContent','CarouselItem','CarouselPrevious','CarouselNext'], status: 'stable' },
  {
    id: 'MQC-UI-012', label: 'chart.tsx',
    path: '/src/app/components/ui/chart.tsx',
    type: 'UI', domain: 'ui-system',
    description: 'shadcn Chart — Recharts wrapper with tooltip/legend helpers. ⚠ EXCEPTION: this file is the ONLY component allowed to use <> fragments (React.Fragment shorthand).',
    demands: [], supplies: ['ChartContainer','ChartTooltip','ChartTooltipContent','ChartLegend','ChartLegendContent'],
    debugNotes: 'UNIQUE EXCEPTION: chart.tsx may use <> fragments. All other components use <span className="contents">. When adding Recharts charts elsewhere: scope SVG gradient IDs, use prefixed string key props on all series/cell children.',
    status: 'stable',
  },
  { id: 'MQC-UI-013', label: 'checkbox.tsx',        path: '/src/app/components/ui/checkbox.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Checkbox — accessible checkbox input.',             demands: [], supplies: ['Checkbox'],                                                        status: 'stable' },
  { id: 'MQC-UI-014', label: 'collapsible.tsx',     path: '/src/app/components/ui/collapsible.tsx',     type: 'UI', domain: 'ui-system', description: 'shadcn Collapsible — show/hide toggle section.',           demands: [], supplies: ['Collapsible','CollapsibleTrigger','CollapsibleContent'],            status: 'stable' },
  { id: 'MQC-UI-015', label: 'command.tsx',         path: '/src/app/components/ui/command.tsx',         type: 'UI', domain: 'ui-system', description: 'shadcn Command — cmdk-powered command menu (used by CommandPalette MQC-CMP-014).',  demands: [], supplies: ['Command','CommandInput','CommandList','CommandItem','CommandGroup','CommandEmpty','CommandDialog'], status: 'stable' },
  { id: 'MQC-UI-016', label: 'context-menu.tsx',    path: '/src/app/components/ui/context-menu.tsx',    type: 'UI', domain: 'ui-system', description: 'shadcn ContextMenu — right-click context menu.',          demands: [], supplies: ['ContextMenu','ContextMenuTrigger','ContextMenuContent','ContextMenuItem'], status: 'stable' },
  { id: 'MQC-UI-017', label: 'dialog.tsx',          path: '/src/app/components/ui/dialog.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Dialog — modal dialog with overlay.',               demands: [], supplies: ['Dialog','DialogTrigger','DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter'], status: 'stable' },
  { id: 'MQC-UI-018', label: 'drawer.tsx',          path: '/src/app/components/ui/drawer.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Drawer — vaul-powered slide-up drawer.',            demands: [], supplies: ['Drawer','DrawerTrigger','DrawerContent','DrawerHeader','DrawerTitle','DrawerFooter'], status: 'stable' },
  { id: 'MQC-UI-019', label: 'dropdown-menu.tsx',   path: '/src/app/components/ui/dropdown-menu.tsx',   type: 'UI', domain: 'ui-system', description: 'shadcn DropdownMenu — radix dropdown with items/checkboxes/radio.',   demands: [], supplies: ['DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator','DropdownMenuCheckboxItem','DropdownMenuRadioItem'], status: 'stable' },
  { id: 'MQC-UI-020', label: 'form.tsx',            path: '/src/app/components/ui/form.tsx',            type: 'UI', domain: 'ui-system', description: 'shadcn Form — react-hook-form integration with validation messages.',  demands: [], supplies: ['Form','FormField','FormItem','FormLabel','FormControl','FormMessage','FormDescription'], status: 'stable' },
  { id: 'MQC-UI-021', label: 'hover-card.tsx',      path: '/src/app/components/ui/hover-card.tsx',      type: 'UI', domain: 'ui-system', description: 'shadcn HoverCard — popover shown on hover.',               demands: [], supplies: ['HoverCard','HoverCardTrigger','HoverCardContent'],                   status: 'stable' },
  { id: 'MQC-UI-022', label: 'input-otp.tsx',       path: '/src/app/components/ui/input-otp.tsx',       type: 'UI', domain: 'ui-system', description: 'shadcn InputOTP — OTP/PIN code entry field.',              demands: [], supplies: ['InputOTP','InputOTPGroup','InputOTPSlot','InputOTPSeparator'],      status: 'stable' },
  { id: 'MQC-UI-023', label: 'input.tsx',           path: '/src/app/components/ui/input.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Input — styled text input.',                       demands: [], supplies: ['Input'],                                                           status: 'stable' },
  { id: 'MQC-UI-024', label: 'label.tsx',           path: '/src/app/components/ui/label.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Label — accessible form label.',                   demands: [], supplies: ['Label'],                                                           status: 'stable' },
  { id: 'MQC-UI-025', label: 'menubar.tsx',         path: '/src/app/components/ui/menubar.tsx',         type: 'UI', domain: 'ui-system', description: 'shadcn Menubar — horizontal menu bar.',                   demands: [], supplies: ['Menubar','MenubarMenu','MenubarTrigger','MenubarContent','MenubarItem'], status: 'stable' },
  { id: 'MQC-UI-026', label: 'navigation-menu.tsx', path: '/src/app/components/ui/navigation-menu.tsx', type: 'UI', domain: 'ui-system', description: 'shadcn NavigationMenu — accessible top-level navigation.',  demands: [], supplies: ['NavigationMenu','NavigationMenuList','NavigationMenuItem','NavigationMenuLink'], status: 'stable' },
  { id: 'MQC-UI-027', label: 'pagination.tsx',      path: '/src/app/components/ui/pagination.tsx',      type: 'UI', domain: 'ui-system', description: 'shadcn Pagination — page navigation controls.',            demands: [], supplies: ['Pagination','PaginationContent','PaginationItem','PaginationPrevious','PaginationNext'], status: 'stable' },
  { id: 'MQC-UI-028', label: 'popover.tsx',         path: '/src/app/components/ui/popover.tsx',         type: 'UI', domain: 'ui-system', description: 'shadcn Popover — floating content panel anchored to trigger.', demands: [], supplies: ['Popover','PopoverTrigger','PopoverContent'],                  status: 'stable' },
  { id: 'MQC-UI-029', label: 'progress.tsx',        path: '/src/app/components/ui/progress.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Progress — linear progress bar.',                  demands: [], supplies: ['Progress'],                                                        status: 'stable' },
  { id: 'MQC-UI-030', label: 'radio-group.tsx',     path: '/src/app/components/ui/radio-group.tsx',     type: 'UI', domain: 'ui-system', description: 'shadcn RadioGroup — accessible radio button group.',        demands: [], supplies: ['RadioGroup','RadioGroupItem'],                                     status: 'stable' },
  { id: 'MQC-UI-031', label: 'resizable.tsx',       path: '/src/app/components/ui/resizable.tsx',       type: 'UI', domain: 'ui-system', description: 'shadcn ResizablePanel — drag-to-resize panel layout.',    demands: [], supplies: ['ResizablePanelGroup','ResizablePanel','ResizableHandle'],          status: 'stable' },
  { id: 'MQC-UI-032', label: 'scroll-area.tsx',     path: '/src/app/components/ui/scroll-area.tsx',     type: 'UI', domain: 'ui-system', description: 'shadcn ScrollArea — custom-scrollbar overflow container.', demands: [], supplies: ['ScrollArea','ScrollBar'],                                         status: 'stable' },
  { id: 'MQC-UI-033', label: 'select.tsx',          path: '/src/app/components/ui/select.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Select — accessible dropdown select.',              demands: [], supplies: ['Select','SelectTrigger','SelectContent','SelectItem','SelectValue','SelectGroup','SelectLabel'], status: 'stable' },
  { id: 'MQC-UI-034', label: 'separator.tsx',       path: '/src/app/components/ui/separator.tsx',       type: 'UI', domain: 'ui-system', description: 'shadcn Separator — horizontal/vertical divider line.',    demands: [], supplies: ['Separator'],                                                       status: 'stable' },
  { id: 'MQC-UI-035', label: 'sheet.tsx',           path: '/src/app/components/ui/sheet.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Sheet — side drawer (left|right|top|bottom).',      demands: [], supplies: ['Sheet','SheetTrigger','SheetContent','SheetHeader','SheetTitle','SheetDescription','SheetFooter'], status: 'stable' },
  { id: 'MQC-UI-036', label: 'sidebar.tsx',         path: '/src/app/components/ui/sidebar.tsx',         type: 'UI', domain: 'ui-system', description: 'shadcn Sidebar — collapsible app sidebar navigation.',    demands: [], supplies: ['Sidebar','SidebarProvider','SidebarContent','SidebarMenu','SidebarMenuItem','SidebarMenuButton','useSidebar'], status: 'stable' },
  { id: 'MQC-UI-037', label: 'skeleton.tsx',        path: '/src/app/components/ui/skeleton.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Skeleton — shimmer loading placeholder.',          demands: [], supplies: ['Skeleton'],                                                        status: 'stable' },
  { id: 'MQC-UI-038', label: 'slider.tsx',          path: '/src/app/components/ui/slider.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Slider — range input slider.',                     demands: [], supplies: ['Slider'],                                                          status: 'stable' },
  { id: 'MQC-UI-039', label: 'sonner.tsx',          path: '/src/app/components/ui/sonner.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Sonner — toast notification wrapper (import toast from sonner, NOT from sonner/ui).',  demands: [], supplies: ['Toaster'], debugNotes: 'Import toast via: import { toast } from "sonner" — NOT from "sonner/ui". If import is wrong, toasts silently fail.', status: 'stable' },
  { id: 'MQC-UI-040', label: 'switch.tsx',          path: '/src/app/components/ui/switch.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Switch — toggle on/off switch.',                   demands: [], supplies: ['Switch'],                                                          status: 'stable' },
  { id: 'MQC-UI-041', label: 'table.tsx',           path: '/src/app/components/ui/table.tsx',           type: 'UI', domain: 'ui-system', description: 'shadcn Table — styled HTML table primitives.',             demands: [], supplies: ['Table','TableHeader','TableBody','TableRow','TableHead','TableCell','TableCaption','TableFooter'], status: 'stable' },
  { id: 'MQC-UI-042', label: 'tabs.tsx',            path: '/src/app/components/ui/tabs.tsx',            type: 'UI', domain: 'ui-system', description: 'shadcn Tabs — accessible tabbed interface.',               demands: [], supplies: ['Tabs','TabsList','TabsTrigger','TabsContent'],                      status: 'stable' },
  { id: 'MQC-UI-043', label: 'textarea.tsx',        path: '/src/app/components/ui/textarea.tsx',        type: 'UI', domain: 'ui-system', description: 'shadcn Textarea — styled multi-line text input.',          demands: [], supplies: ['Textarea'],                                                        status: 'stable' },
  { id: 'MQC-UI-044', label: 'toggle-group.tsx',    path: '/src/app/components/ui/toggle-group.tsx',    type: 'UI', domain: 'ui-system', description: 'shadcn ToggleGroup — group of mutually-exclusive toggle buttons.', demands: [], supplies: ['ToggleGroup','ToggleGroupItem'],                    status: 'stable' },
  { id: 'MQC-UI-045', label: 'toggle.tsx',          path: '/src/app/components/ui/toggle.tsx',          type: 'UI', domain: 'ui-system', description: 'shadcn Toggle — individual on/off button.',               demands: [], supplies: ['Toggle','toggleVariants'],                                         status: 'stable' },
  { id: 'MQC-UI-046', label: 'tooltip.tsx',         path: '/src/app/components/ui/tooltip.tsx',         type: 'UI', domain: 'ui-system', description: 'shadcn Tooltip — hover tooltip.',                         demands: [], supplies: ['Tooltip','TooltipTrigger','TooltipContent','TooltipProvider'],    status: 'stable' },
  {
    id: 'MQC-UI-047', label: 'use-mobile.ts',
    path: '/src/app/components/ui/use-mobile.ts',
    type: 'UI', domain: 'ui-system',
    description: 'useIsMobile hook — returns boolean based on 768px breakpoint. Used by Sidebar to toggle mobile layout.',
    demands: [], supplies: ['useIsMobile'],
    status: 'stable',
  },
  {
    id: 'MQC-UI-048', label: 'utils.ts (ui)',
    path: '/src/app/components/ui/utils.ts',
    type: 'UI', domain: 'ui-system',
    description: 'shadcn cn() utility — merges Tailwind class names using clsx + tailwind-merge. Used by every UI component.',
    demands: [], supplies: ['cn'],
    debugNotes: 'Every shadcn component uses cn() for conditional class merging. If styles are not applying correctly, check that cn() is being called correctly.',
    status: 'stable',
  },
];

// ============================================================================
// O. PROTECTED SYSTEM FILES
// ============================================================================

export const PRO_NODES: RegistryNode[] = [
  {
    id: 'MQC-PRO-001',
    label: 'ImageWithFallback.tsx',
    path: '/src/app/components/figma/ImageWithFallback.tsx',
    type: 'UI' as any,
    domain: 'ui-system',
    description: '⛔ PROTECTED — DO NOT MODIFY. Figma Make image component with error fallback. Must be used instead of <img> tags when creating NEW images. Raster figma:asset images use virtual import scheme (no path prefix). Works identically to <img> tag.',
    demands: [],
    supplies: ['ImageWithFallback'],
    debugNotes: '⛔ PROTECTED FILE. Usage: import { ImageWithFallback } from "./components/figma/ImageWithFallback". For figma:asset images use: import img from "figma:asset/hash.png" (NOT "../imports/figma:asset/...").',
    status: 'protected',
  },
  {
    id: 'MQC-PRO-002',
    label: 'info.tsx',
    path: '/utils/supabase/info.tsx',
    type: 'CFG' as any,
    domain: 'backend-infra',
    description: '⛔ PROTECTED — DO NOT MODIFY. Exports projectId and publicAnonKey used to construct the Supabase Edge Function base URL and to authenticate frontend → backend calls. Imported by api.ts.',
    demands: [],
    supplies: ['projectId', 'publicAnonKey'],
    debugNotes: '⛔ PROTECTED FILE. If projectId or publicAnonKey are wrong, ALL API calls will fail with 401 or "fetch failed". These values are environment-injected by the Figma Make platform.',
    status: 'protected',
  },
];

// ============================================================================
// P. STYLE / CSS FILES
// ============================================================================

export const STY_NODES: RegistryNode[] = [
  {
    id: 'MQC-STY-001',
    label: 'fonts.css',
    path: '/src/styles/fonts.css',
    type: 'STY' as any,
    domain: 'ui-system',
    description: 'Font imports file. ALL @import url() font declarations must go here and only here. Never add font imports to other CSS files.',
    demands: [],
    supplies: ['Font declarations'],
    debugNotes: 'RULE: font imports go ONLY in this file, at the top. If a custom font is not loading, check here first.',
    status: 'stable',
  },
  {
    id: 'MQC-STY-002',
    label: 'index.css',
    path: '/src/styles/index.css',
    type: 'STY' as any,
    domain: 'ui-system',
    description: 'Global stylesheet entry. Imports Tailwind base, theme, and fonts. Root of the CSS pipeline.',
    demands: ['MQC-STY-001','MQC-STY-003','MQC-STY-004'],
    supplies: ['Global styles'],
    status: 'stable',
  },
  {
    id: 'MQC-STY-003',
    label: 'tailwind.css',
    path: '/src/styles/tailwind.css',
    type: 'STY' as any,
    domain: 'ui-system',
    description: 'Tailwind CSS v4 directives (@import "tailwindcss"). The project uses Tailwind v4 — do not create a tailwind.config.js.',
    demands: [],
    supplies: ['Tailwind utility classes'],
    debugNotes: 'Project uses Tailwind v4. Do NOT create tailwind.config.js — it will conflict. Use theme.css tokens instead.',
    status: 'stable',
  },
  {
    id: 'MQC-STY-004',
    label: 'theme.css',
    path: '/src/styles/theme.css',
    type: 'STY' as any,
    domain: 'ui-system',
    description: 'Eclipse UI dark theme tokens. CSS custom properties for all colors, spacing, typography. Background: #0A0A0F, primary: #8B5CF6 (purple). Do NOT modify unless user explicitly requests a design style change.',
    demands: [],
    supplies: ['CSS custom properties (design tokens)', '--background', '--foreground', '--primary', 'h1/h2/etc default styles'],
    debugNotes: 'CAUTION: h1, h2 etc. may have default styles defined here that override Tailwind. If heading sizes look wrong, check this file. Do not modify token values without explicit user request.',
    status: 'stable',
  },
];

// ============================================================================
// Q. INFRASTRUCTURE / BUILD FILES
// ============================================================================

export const INF_NODES: RegistryNode[] = [
  {
    id: 'MQC-INF-001',
    label: 'vite.config.ts',
    path: '/vite.config.ts',
    type: 'INF' as any,
    domain: 'app-root',
    description: 'Vite build configuration. Defines @/ path alias pointing to /src. Configures React plugin and figma:asset virtual module scheme.',
    demands: [],
    supplies: ['Build config', '@/ alias → /src', 'figma:asset virtual module'],
    debugNotes: 'The @/ alias is defined here. If imports using @/ fail, check vite.config.ts. The figma:asset scheme is also configured here.',
    status: 'stable',
  },
  {
    id: 'MQC-INF-002',
    label: 'postcss.config.mjs',
    path: '/postcss.config.mjs',
    type: 'INF' as any,
    domain: 'ui-system',
    description: 'PostCSS configuration for Tailwind CSS processing pipeline.',
    demands: [],
    supplies: ['PostCSS processing pipeline'],
    status: 'stable',
  },
  {
    id: 'MQC-INF-003',
    label: 'package.json',
    path: '/package.json',
    type: 'INF' as any,
    domain: 'app-root',
    description: 'NPM package manifest. Lists all dependencies and devDependencies. Check here before using install_package to avoid duplicate installs.',
    demands: [],
    supplies: ['Dependency manifest', 'npm scripts'],
    debugNotes: 'Always read package.json FIRST before running install_package. If a package is already listed here, do not install again.',
    status: 'stable',
  },
  {
    id: 'MQC-INF-004',
    label: 'index.html',
    path: '/index.html',
    type: 'INF' as any,
    domain: 'app-root',
    description: 'HTML entry point. Mounts the React app at #root div. References main.tsx as module script.',
    demands: ['MQC-APP-002'],
    supplies: ['HTML shell', '#root mount point'],
    status: 'stable',
  },
];

// ============================================================================
// R. DOCUMENTATION FILES
// ============================================================================

export const DOC_NODES: RegistryNode[] = [
  {
    id: 'MQC-DOC-001',
    label: 'API_SPECIFICATIONS.md',
    path: '/API_SPECIFICATIONS.md',
    type: 'DOC' as any,
    domain: 'backend-core',
    description: 'Full API specifications for all 60 backend routes. Request/response shapes, auth requirements, error codes. Referenced in the 5-step ops checklist in dataService.ts.',
    demands: [],
    supplies: ['API contract documentation'],
    status: 'stable',
  },
  {
    id: 'MQC-DOC-002',
    label: 'ATTRIBUTIONS.md',
    path: '/ATTRIBUTIONS.md',
    type: 'DOC' as any,
    domain: 'app-root',
    description: 'Third-party library attributions and licenses.',
    demands: [],
    supplies: ['License attributions'],
    status: 'stable',
  },
  {
    id: 'MQC-DOC-003',
    label: 'BACKEND_QUICKSTART.md',
    path: '/BACKEND_QUICKSTART.md',
    type: 'DOC' as any,
    domain: 'backend-core',
    description: 'Backend deployment quickstart guide. Steps to deploy Supabase Edge Functions and set secrets.',
    demands: [],
    supplies: ['Backend setup guide'],
    status: 'stable',
  },
  {
    id: 'MQC-DOC-004',
    label: 'DATABASE_SCHEMA.md',
    path: '/DATABASE_SCHEMA.md',
    type: 'DOC' as any,
    domain: 'backend-core',
    description: 'Database schema documentation for the kv_store_324f4fbe table and KV key prefix conventions.',
    demands: [],
    supplies: ['DB schema docs'],
    status: 'stable',
  },
  {
    id: 'MQC-DOC-005',
    label: 'DEPLOYMENT_GUIDE.md',
    path: '/DEPLOYMENT_GUIDE.md',
    type: 'DOC' as any,
    domain: 'backend-core',
    description: 'Full production deployment guide. Covers Supabase setup, secrets, domain config, and the 5-step ops cutover checklist.',
    demands: [],
    supplies: ['Deployment instructions'],
    status: 'stable',
  },
  {
    id: 'MQC-DOC-006',
    label: 'Guidelines.md',
    path: '/guidelines/Guidelines.md',
    type: 'DOC' as any,
    domain: 'app-root',
    description: 'Coding conventions and project guidelines. Covers the key rules: createHashRouter, ?? 0 null-safety, <span className="contents"> convention, designTokens.ts centralization, TeamDashboardLayout two-layer pattern, Service Layer Abstraction rules.',
    demands: [],
    supplies: ['Coding conventions', 'Architecture rules'],
    debugNotes: 'KEY RULES documented here: (1) createHashRouter not createBrowserRouter (2) (value ?? 0).toFixed() null-safety (3) <span className="contents"> not <> (4) designTokens.ts for all design values (5) two-layer TeamDashboardLayout pattern (6) all data access through dataService.ts',
    status: 'stable',
  },
];

// ============================================================================
// S. IMPORT SPEC / SCHEMA / ASSET FILES  (/src/imports/)
// ============================================================================

export const SPC_NODES: RegistryNode[] = [
  { id: 'MQC-SPC-001', label: 'Desktop06.tsx',                      path: '/src/imports/Desktop06.tsx',                      type: 'IMP' as any, domain: 'ui-system',        description: 'Figma frame import — Desktop06 component. Used as design reference for UI layout.', demands: [], supplies: ['Desktop06 component'], status: 'stable' },
  { id: 'MQC-SPC-002', label: 'svg-nghy73bfh3.ts',                  path: '/src/imports/svg-nghy73bfh3.ts',                  type: 'IMP' as any, domain: 'ui-system',        description: 'SVG path data asset. Import via relative path from component. Do NOT recreate — use this import directly.', demands: [], supplies: ['SVG path data'], status: 'stable' },
  { id: 'MQC-SPC-003', label: 'ai-assist-per-block.md',             path: '/src/imports/ai-assist-per-block.md',             type: 'DOC' as any, domain: 'ai-cortex',        description: 'Spec: AI assist per execution block — defines how AI suggestions are triggered per block type.', demands: [], supplies: ['AI block assist spec'], status: 'stable' },
  { id: 'MQC-SPC-004', label: 'architecture-overview-1.md',         path: '/src/imports/architecture-overview-1.md',         type: 'DOC' as any, domain: 'app-root',         description: 'System architecture overview (version 1).', demands: [], supplies: ['Architecture spec v1'], status: 'stable' },
  { id: 'MQC-SPC-005', label: 'architecture-overview.md',           path: '/src/imports/architecture-overview.md',           type: 'DOC' as any, domain: 'app-root',         description: 'System architecture overview (current).', demands: [], supplies: ['Architecture spec'], status: 'stable' },
  { id: 'MQC-SPC-006', label: 'cashflow-timeline-model.md',         path: '/src/imports/cashflow-timeline-model.md',         type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: cashflow timeline model — math and logic behind MQC-ENG-003.', demands: [], supplies: ['Cashflow model spec'], status: 'stable' },
  { id: 'MQC-SPC-007', label: 'contract-auto-gen.md',               path: '/src/imports/contract-auto-gen.md',               type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: contract auto-generation — logic behind MQC-ENG-006.', demands: [], supplies: ['Contract gen spec'], status: 'stable' },
  { id: 'MQC-SPC-008', label: 'copilot-patch-plan.md',              path: '/src/imports/copilot-patch-plan.md',              type: 'DOC' as any, domain: 'ai-cortex',        description: 'Spec: copilot patch implementation plan — basis for MQC-BEF-006.', demands: [], supplies: ['Copilot spec'], status: 'stable' },
  { id: 'MQC-SPC-009', label: 'cortex-audit-report.md',             path: '/src/imports/cortex-audit-report.md',             type: 'DOC' as any, domain: 'ai-cortex',        description: 'CORTEX system audit report — documents architectural decisions and known constraints.', demands: [], supplies: ['Audit report'], status: 'stable' },
  { id: 'MQC-SPC-010', label: 'cortex-rules.md',                    path: '/src/imports/cortex-rules.md',                    type: 'DOC' as any, domain: 'ai-cortex',        description: 'Core CORTEX governance rules. Primary source of "Math decides priority, LLM only explains decisions" principle.', demands: [], supplies: ['CORTEX rules'], debugNotes: 'THIS IS THE GOVERNING DOCUMENT for the "Math decides priority" principle. If AI behavior deviates, consult this file.', status: 'stable' },
  { id: 'MQC-SPC-011', label: 'cost-modeling-layer.md',             path: '/src/imports/cost-modeling-layer.md',             type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: cost modeling layer — math behind MQC-ENG-008.', demands: [], supplies: ['Cost model spec'], status: 'stable' },
  { id: 'MQC-SPC-012', label: 'crm-sync-spec.md',                   path: '/src/imports/crm-sync-spec.md',                   type: 'DOC' as any, domain: 'team-dashboard',   description: 'Spec: CRM synchronization — defines MQC-ENG-009 behavior.', demands: [], supplies: ['CRM sync spec'], status: 'stable' },
  { id: 'MQC-SPC-013', label: 'dashboard-specs-1.md',               path: '/src/imports/dashboard-specs-1.md',               type: 'DOC' as any, domain: 'team-dashboard',   description: 'Dashboard specifications version 1.', demands: [], supplies: ['Dashboard spec v1'], status: 'stable' },
  { id: 'MQC-SPC-014', label: 'dashboard-specs.md',                 path: '/src/imports/dashboard-specs.md',                 type: 'DOC' as any, domain: 'team-dashboard',   description: 'Dashboard specifications (current).', demands: [], supplies: ['Dashboard spec'], status: 'stable' },
  { id: 'MQC-SPC-015', label: 'dcf-integration-spec.md',            path: '/src/imports/dcf-integration-spec.md',            type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: DCF integration — math and wiring for MQC-ENG-011.', demands: [], supplies: ['DCF spec'], status: 'stable' },
  { id: 'MQC-SPC-016', label: 'diagnostic-intelligence-schema-1.json', path: '/src/imports/diagnostic-intelligence-schema-1.json', type: 'DOC' as any, domain: 'public-funnel', description: 'JSON schema: diagnostic intelligence data structure v1.', demands: [], supplies: ['Diagnostic schema v1'], status: 'stable' },
  { id: 'MQC-SPC-017', label: 'diagnostic-intelligence-schema.json', path: '/src/imports/diagnostic-intelligence-schema.json', type: 'DOC' as any, domain: 'public-funnel',   description: 'JSON schema: diagnostic intelligence data structure (current).', demands: [], supplies: ['Diagnostic schema'], status: 'stable' },
  { id: 'MQC-SPC-018', label: 'diagnostic-schema.md',               path: '/src/imports/diagnostic-schema.md',               type: 'DOC' as any, domain: 'public-funnel',    description: 'Spec: diagnostic form schema — question structure and scoring weights.', demands: [], supplies: ['Diagnostic schema spec'], status: 'stable' },
  { id: 'MQC-SPC-019', label: 'diagnostic-structure-1.md',          path: '/src/imports/diagnostic-structure-1.md',          type: 'DOC' as any, domain: 'public-funnel',    description: 'Spec: diagnostic structure v1.', demands: [], supplies: ['Diagnostic structure spec'], status: 'stable' },
  { id: 'MQC-SPC-020', label: 'ecommerce-diagnostic-report.json',   path: '/src/imports/ecommerce-diagnostic-report.json',   type: 'DOC' as any, domain: 'public-funnel',    description: 'Sample e-commerce diagnostic report JSON — used as reference data.', demands: [], supplies: ['Sample report (ecommerce)'], status: 'stable' },
  { id: 'MQC-SPC-021', label: 'editable-blocks-schema.json',        path: '/src/imports/editable-blocks-schema.json',        type: 'DOC' as any, domain: 'execution-system', description: 'JSON schema for editable execution blocks — defines block field structure for MQC-ENG-002.', demands: [], supplies: ['Block schema'], status: 'stable' },
  { id: 'MQC-SPC-022', label: 'exampleco-diagnostic-report.json',   path: '/src/imports/exampleco-diagnostic-report.json',   type: 'DOC' as any, domain: 'public-funnel',    description: 'Sample ExampleCo diagnostic report — demo reference data.', demands: [], supplies: ['Sample report (ExampleCo)'], status: 'stable' },
  { id: 'MQC-SPC-023', label: 'exampleco-portfolio-diagnostic-1.json', path: '/src/imports/exampleco-portfolio-diagnostic-1.json', type: 'DOC' as any, domain: 'analytics',  description: 'Sample ExampleCo portfolio diagnostic v1.', demands: [], supplies: ['Portfolio diagnostic v1'], status: 'stable' },
  { id: 'MQC-SPC-024', label: 'exampleco-portfolio-diagnostic.json', path: '/src/imports/exampleco-portfolio-diagnostic.json', type: 'DOC' as any, domain: 'analytics',       description: 'Sample ExampleCo portfolio diagnostic (current).', demands: [], supplies: ['Portfolio diagnostic'], status: 'stable' },
  { id: 'MQC-SPC-025', label: 'execution-blueprint.md',             path: '/src/imports/execution-blueprint.md',             type: 'DOC' as any, domain: 'execution-system',  description: 'Spec: execution plan blueprint — sprint structure and block ordering for MQC-ENG-014.', demands: [], supplies: ['Execution blueprint spec'], status: 'stable' },
  { id: 'MQC-SPC-026', label: 'financial-summary-binding-1.md',     path: '/src/imports/financial-summary-binding-1.md',     type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: financial summary data binding v1.', demands: [], supplies: ['Financial binding spec'], status: 'stable' },
  { id: 'MQC-SPC-027', label: 'implementation-architecture.md',     path: '/src/imports/implementation-architecture.md',     type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: implementation architecture — solution tech stack specs.', demands: [], supplies: ['Impl architecture spec'], status: 'stable' },
  { id: 'MQC-SPC-028', label: 'irr-integration-spec.md',            path: '/src/imports/irr-integration-spec.md',            type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: IRR integration — Newton-Raphson math for MQC-ENG-018.', demands: [], supplies: ['IRR spec'], status: 'stable' },
  { id: 'MQC-SPC-029', label: 'mapping-engine-process.md',          path: '/src/imports/mapping-engine-process.md',          type: 'DOC' as any, domain: 'ai-cortex',        description: 'Spec: mapping engine process — answer→solution mapping algorithm for MQC-ENG-019.', demands: [], supplies: ['Mapping engine spec'], status: 'stable' },
  { id: 'MQC-SPC-030', label: 'monte-carlo-spec.md',                path: '/src/imports/monte-carlo-spec.md',                type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: Monte Carlo simulation — statistical methodology for MQC-ENG-020.', demands: [], supplies: ['Monte Carlo spec'], status: 'stable' },
  { id: 'MQC-SPC-031', label: 'phase-p1-implementation-1.md',       path: '/src/imports/phase-p1-implementation-1.md',       type: 'DOC' as any, domain: 'app-root',         description: 'Phase P1 implementation plan v1.', demands: [], supplies: ['P1 plan v1'], status: 'stable' },
  { id: 'MQC-SPC-032', label: 'phase-p1-implementation.md',         path: '/src/imports/phase-p1-implementation.md',         type: 'DOC' as any, domain: 'app-root',         description: 'Phase P1 implementation plan (current).', demands: [], supplies: ['P1 plan'], status: 'stable' },
  { id: 'MQC-SPC-033', label: 'phase1-gate-criteria.md',            path: '/src/imports/phase1-gate-criteria.md',            type: 'DOC' as any, domain: 'ai-cortex',        description: 'Phase 1 gate criteria — readiness thresholds for proposal generation.', demands: [], supplies: ['Gate criteria'], status: 'stable' },
  { id: 'MQC-SPC-034', label: 'phase1-gate-requirements.md',        path: '/src/imports/phase1-gate-requirements.md',        type: 'DOC' as any, domain: 'ai-cortex',        description: 'Phase 1 gate requirements (detailed).', demands: [], supplies: ['Gate requirements'], status: 'stable' },
  { id: 'MQC-SPC-035', label: 'proposal-control-export-1.md',       path: '/src/imports/proposal-control-export-1.md',       type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: proposal control & export v1.', demands: [], supplies: ['Proposal export spec v1'], status: 'stable' },
  { id: 'MQC-SPC-036', label: 'proposal-control-export.md',         path: '/src/imports/proposal-control-export.md',         type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: proposal control & export (current) — defines MQC-CMP-057 behavior.', demands: [], supplies: ['Proposal export spec'], status: 'stable' },
  { id: 'MQC-SPC-037', label: 'proposal-data-model.json',           path: '/src/imports/proposal-data-model.json',           type: 'DOC' as any, domain: 'proposal-system',   description: 'JSON data model for proposal drafts — source of truth for MQC-TYP-007.', demands: [], supplies: ['Proposal data model'], status: 'stable' },
  { id: 'MQC-SPC-038', label: 'proposal-p2-implementation.md',      path: '/src/imports/proposal-p2-implementation.md',      type: 'DOC' as any, domain: 'proposal-system',   description: 'Phase P2 proposal implementation plan.', demands: [], supplies: ['P2 plan'], status: 'stable' },
  { id: 'MQC-SPC-039', label: 'qbr-generator-overview.md',          path: '/src/imports/qbr-generator-overview.md',          type: 'DOC' as any, domain: 'analytics',        description: 'Spec: QBR generator — defines MQC-ENG-024 computation logic.', demands: [], supplies: ['QBR spec'], status: 'stable' },
  { id: 'MQC-SPC-040', label: 'ready-gate-rules.md',                path: '/src/imports/ready-gate-rules.md',                type: 'DOC' as any, domain: 'ai-cortex',        description: 'Spec: readiness gate rules — scoring thresholds that determine proposal eligibility.', demands: [], supplies: ['Ready gate rules'], status: 'stable' },
  { id: 'MQC-SPC-041', label: 'recommendation-engine-guide.md',     path: '/src/imports/recommendation-engine-guide.md',     type: 'DOC' as any, domain: 'ai-cortex',        description: 'Spec: recommendation engine guide — how solutions are recommended from scores.', demands: [], supplies: ['Recommendation engine guide'], status: 'stable' },
  { id: 'MQC-SPC-042', label: 'recommendation-portfolio.md',        path: '/src/imports/recommendation-portfolio.md',        type: 'DOC' as any, domain: 'analytics',        description: 'Spec: portfolio-level recommendations.', demands: [], supplies: ['Portfolio recommendation spec'], status: 'stable' },
  { id: 'MQC-SPC-043', label: 'recommendation-schema-2.json',       path: '/src/imports/recommendation-schema-2.json',       type: 'DOC' as any, domain: 'ai-cortex',        description: 'JSON schema for recommendation output v2.', demands: [], supplies: ['Recommendation schema v2'], status: 'stable' },
  { id: 'MQC-SPC-044', label: 'recommendation-schema.json',         path: '/src/imports/recommendation-schema.json',         type: 'DOC' as any, domain: 'ai-cortex',        description: 'JSON schema for recommendation output (current).', demands: [], supplies: ['Recommendation schema'], status: 'stable' },
  { id: 'MQC-SPC-045', label: 'revenue-control-process.md',         path: '/src/imports/revenue-control-process.md',         type: 'DOC' as any, domain: 'analytics',        description: 'Spec: revenue control process — pipeline for MQC-CMP-068.', demands: [], supplies: ['Revenue control spec'], status: 'stable' },
  { id: 'MQC-SPC-046', label: 'roi-actuals-engine.md',              path: '/src/imports/roi-actuals-engine.md',              type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI actuals engine — actual vs projected tracking for MQC-ENG-025.', demands: [], supplies: ['ROI actuals spec'], status: 'stable' },
  { id: 'MQC-SPC-047', label: 'roi-analysis-results.json',          path: '/src/imports/roi-analysis-results.json',          type: 'DOC' as any, domain: 'roi-engine',       description: 'Sample ROI analysis output — reference data.', demands: [], supplies: ['Sample ROI results'], status: 'stable' },
  { id: 'MQC-SPC-048', label: 'roi-analysis.json',                  path: '/src/imports/roi-analysis.json',                  type: 'DOC' as any, domain: 'roi-engine',       description: 'ROI analysis configuration JSON.', demands: [], supplies: ['ROI analysis config'], status: 'stable' },
  { id: 'MQC-SPC-049', label: 'roi-assumptions-editor.md',          path: '/src/imports/roi-assumptions-editor.md',          type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI assumptions editor UI — defines MQC-CMP-064.', demands: [], supplies: ['ROI assumptions spec'], status: 'stable' },
  { id: 'MQC-SPC-050', label: 'roi-dashboard-specs.md',             path: '/src/imports/roi-dashboard-specs.md',             type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI dashboard layout and components.', demands: [], supplies: ['ROI dashboard spec'], status: 'stable' },
  { id: 'MQC-SPC-051', label: 'roi-dependency-spec.md',             path: '/src/imports/roi-dependency-spec.md',             type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI engine dependencies — MQC-ENG-026 input/output contracts.', demands: [], supplies: ['ROI dependency spec'], status: 'stable' },
  { id: 'MQC-SPC-052', label: 'roi-engine-math-doc.md',             path: '/src/imports/roi-engine-math-doc.md',             type: 'DOC' as any, domain: 'roi-engine',       description: 'MATH DOCUMENTATION for the ROI engine. Formulas, assumptions, and derivations.', demands: [], supplies: ['ROI math documentation'], debugNotes: 'This is the authoritative source for all ROI formulas. Consult when debugging MQC-ENG-026 calculation discrepancies.', status: 'stable' },
  { id: 'MQC-SPC-053', label: 'roi-modeling-guide.md',              path: '/src/imports/roi-modeling-guide.md',              type: 'DOC' as any, domain: 'roi-engine',       description: 'Guide: ROI modeling methodology.', demands: [], supplies: ['ROI modeling guide'], status: 'stable' },
  { id: 'MQC-SPC-054', label: 'roi-system-integration-spec.md',     path: '/src/imports/roi-system-integration-spec.md',     type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI system integration — how ROI engines connect to the rest of the stack.', demands: [], supplies: ['ROI integration spec'], status: 'stable' },
  { id: 'MQC-SPC-055', label: 'roi-tracking-spec.md',               path: '/src/imports/roi-tracking-spec.md',               type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: ROI tracking — defines MQC-ENG-027.', demands: [], supplies: ['ROI tracking spec'], status: 'stable' },
  { id: 'MQC-SPC-056', label: 'roi-wireframe.md',                   path: '/src/imports/roi-wireframe.md',                   type: 'DOC' as any, domain: 'roi-engine',       description: 'ROI UI wireframes and layout descriptions.', demands: [], supplies: ['ROI wireframes'], status: 'stable' },
  { id: 'MQC-SPC-057', label: 'scenario-modeling-spec.md',          path: '/src/imports/scenario-modeling-spec.md',          type: 'DOC' as any, domain: 'roi-engine',       description: 'Spec: scenario modeling — best/base/worst case engine for MQC-ENG-029.', demands: [], supplies: ['Scenario spec'], status: 'stable' },
  { id: 'MQC-SPC-058', label: 'scope-engine-logic.md',              path: '/src/imports/scope-engine-logic.md',              type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: scope engine logic — proposal scope assembly for MQC-ENG-030.', demands: [], supplies: ['Scope engine spec'], status: 'stable' },
  { id: 'MQC-SPC-059', label: 'solution-architecture-binding.md',   path: '/src/imports/solution-architecture-binding.md',   type: 'DOC' as any, domain: 'proposal-system',   description: 'Spec: solution architecture data binding for MQC-CMP-077.', demands: [], supplies: ['Solution architecture spec'], status: 'stable' },
  { id: 'MQC-SPC-060', label: 'system-build-order.md',              path: '/src/imports/system-build-order.md',              type: 'DOC' as any, domain: 'app-root',         description: 'System build order documentation — sequence in which modules were constructed.', demands: [], supplies: ['Build order docs'], status: 'stable' },
];

// ============================================================================
// T. INDIVIDUAL BACKEND FUNCTIONS  (sub-nodes of BEF files)
// ============================================================================
// These are key functions WITHIN backend files, given their own IDs because
// they are commonly referenced individually during debugging.

export const FN_NODES: RegistryNode[] = [
  // ── server/index.tsx helper functions (MQC-BEF-001) ──
  {
    id: 'MQC-FN-001', label: 'verifyTeamToken()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'team-auth',
    description: 'Validates a Bearer JWT via supabaseAdmin.auth.getUser(token). Returns userId string or null. Used by EVERY team-auth-protected route in index.tsx.',
    demands: ['MQC-BEF-001'],
    supplies: ['userId: string | null'],
    debugNotes: 'If returns null: token expired, malformed, or wrong key. Check: (1) accessToken stored correctly in frontend (2) Authorization header format is "Bearer {token}" (3) Supabase project ID matches.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-002', label: 'safeJsonParse()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-core',
    description: 'Safe JSON parser for KV store values. Handles: null/undefined/empty string → null; already-parsed objects → return as-is; strings starting with { or [ → JSON.parse; primitives → return as-is. Prevents crashes on malformed KV data.',
    demands: ['MQC-BEF-001'],
    supplies: ['parsed value | null'],
    debugNotes: 'If KV data is not coming back correctly, check safeJsonParse(). Common issue: value stored as double-JSON-stringified (JSON.stringify called twice). Verify storage with kv.get and inspect raw value.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-003', label: 'parseSubmissions()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-core',
    description: 'Filters raw kv.getByPrefix("sub:") array into valid submission objects. Skips non-submission entries (e.g. sub_email: keys that leak into prefix scan) and malformed JSON. Returns only objects with an `id` property.',
    demands: ['MQC-FN-002','MQC-BEF-001'],
    supplies: ['submission[]'],
    debugNotes: 'If submission count is wrong on GET /submissions: (1) check that sub_email: keys are not being counted as submissions (2) check that sub: keys exist and are valid JSON objects with `id` field.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-004', label: 'storeNotification()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'team-dashboard',
    description: 'Stores an in-app notification in KV under notif:{timestamp}-{random} key. Types: new_submission | status_change | urgent.',
    demands: ['MQC-FN-011','MQC-BEF-001'],
    supplies: ['notification stored in KV'],
    status: 'stable',
  },
  {
    id: 'MQC-FN-005', label: 'getNotifPrefs()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-email',
    description: 'Reads notification preferences from KV key "settings:platform". Returns Record<string, boolean>. Defaults to empty object (all prefs considered enabled) if not set.',
    demands: ['MQC-FN-010','MQC-BEF-001'],
    supplies: ['notifPrefs: Record<string, boolean>'],
    debugNotes: 'If emails stop firing: check notifPrefs. Preferences are stored at KV key "settings:platform" → notificationPrefs object. Each pref defaults to true if absent.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-006', label: 'getTeamEmail()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-email',
    description: 'Resolves the team admin email address. Priority: (1) Supabase Auth admin user with teamRole=admin (2) any team role user (3) any user with email (4) TEAM_ADMIN_EMAIL env var (5) hardcoded fallback admin@marqcortex.com.',
    demands: ['MQC-BEF-001'],
    supplies: ['teamEmail: string'],
    debugNotes: 'If team emails going to wrong address: check Supabase Auth users for user_metadata.role="team" and user_metadata.teamRole="admin". The function looks for this metadata.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-007', label: 'fireEmail()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-email',
    description: 'Conditionally fires an email notification. Takes: enabled (bool from notifPrefs), fn (async email send function), label (for logging). If enabled=false, logs "[EMAIL GATED]" and returns. Errors are non-fatal (caught and logged).',
    demands: ['MQC-BEF-007','MQC-BEF-001'],
    supplies: ['void (fire-and-forget)'],
    debugNotes: 'If an email is not being sent: (1) check that fireEmail enabled param is true (2) check notifPrefs for the relevant key (3) check RESEND_API_KEY is set in Supabase secrets.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-008', label: 'seedAdminUser()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'team-auth',
    description: 'Idempotent admin user seeder. Runs on server startup. Reads TEAM_ADMIN_EMAIL/TEAM_ADMIN_PASSWORD/TEAM_ADMIN_NAME from env vars. Fails closed: seeds an admin only when TEAM_ADMIN_PASSWORD is set, or ALLOW_DEMO_ADMIN=true is explicitly opted in for local demos. Creates user if not exists.',
    demands: ['MQC-BEF-001'],
    supplies: ['admin user in Supabase Auth (idempotent)'],
    debugNotes: 'No built-in password is seeded in production. Set TEAM_ADMIN_EMAIL + TEAM_ADMIN_PASSWORD env vars in Supabase to seed a real admin; use ALLOW_DEMO_ADMIN=true only for local/demo. Runs on every cold start but is idempotent.',
    status: 'stable',
  },
  {
    id: 'MQC-FN-009', label: 'testDatabaseConnection()',
    path: '/supabase/functions/server/index.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'KV connectivity test that runs on server startup. Writes startup_test_{timestamp}="ok", reads it back, deletes it. Logs success or failure. Non-blocking.',
    demands: ['MQC-FN-010','MQC-FN-011','MQC-FN-012','MQC-BEF-001'],
    supplies: ['boolean (connected or not)'],
    debugNotes: 'If startup logs show "Database connection test failed": Supabase DB is unreachable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are set in Edge Function.',
    status: 'stable',
  },

  // ── kv_store.tsx operations (MQC-BEF-008) ──
  {
    id: 'MQC-FN-010', label: 'kv.get()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Read a single value by key from kv_store_324f4fbe. Returns the value or null if not found.',
    demands: ['MQC-BEF-008'],
    supplies: ['value | null'],
    debugNotes: '⛔ kv_store.tsx is PROTECTED — never modify. Usage: const val = await kv.get("prefix:key"). Returns null if key not found (does NOT throw).',
    status: 'protected',
  },
  {
    id: 'MQC-FN-011', label: 'kv.set()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Write a key-value pair to kv_store_324f4fbe. Upserts (insert or update). Value is stored as-is — if passing objects, JSON.stringify() first.',
    demands: ['MQC-BEF-008'],
    supplies: ['void'],
    debugNotes: 'Objects MUST be JSON.stringify()\'d before kv.set(). Common bug: storing raw object → reads back as "[object Object]". Always: await kv.set(key, JSON.stringify(obj)).',
    status: 'protected',
  },
  {
    id: 'MQC-FN-012', label: 'kv.del()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Delete a key from kv_store_324f4fbe.',
    demands: ['MQC-BEF-008'],
    supplies: ['void'],
    status: 'protected',
  },
  {
    id: 'MQC-FN-013', label: 'kv.mget()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Read multiple values by array of keys. Returns array of values (null for missing keys).',
    demands: ['MQC-BEF-008'],
    supplies: ['(value | null)[]'],
    status: 'protected',
  },
  {
    id: 'MQC-FN-014', label: 'kv.mset()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Write multiple key-value pairs atomically.',
    demands: ['MQC-BEF-008'],
    supplies: ['void'],
    status: 'protected',
  },
  {
    id: 'MQC-FN-015', label: 'kv.mdel()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Delete multiple keys atomically.',
    demands: ['MQC-BEF-008'],
    supplies: ['void'],
    status: 'protected',
  },
  {
    id: 'MQC-FN-016', label: 'kv.getByPrefix()',
    path: '/supabase/functions/server/kv_store.tsx',
    type: 'FN' as any, domain: 'backend-infra',
    description: 'Scan all keys matching a prefix and return their values as an array. Used for list operations (e.g. getByPrefix("sub:") returns all submissions). There is NO generic list() function — use getByPrefix().',
    demands: ['MQC-BEF-008'],
    supplies: ['value[]'],
    debugNotes: 'IMPORTANT: There is no kv.list() — use kv.getByPrefix() for all listing operations. Results may include both target objects AND index entries (e.g. sub: scan may include sub_email: entries) — always filter with parseSubmissions() or similar.',
    status: 'protected',
  },
];

// ============================================================================
// U. MISSING API ROUTES (discovered in matches 51–60 of full scan)
// ============================================================================

export const API_EXTENSION_NODES: RegistryNode[] = [
  {
    id: 'MQC-API-059',
    label: 'GET /cortex/learning-loop',
    path: '/make-server-324f4fbe/cortex/learning-loop',
    type: 'API', domain: 'ai-cortex',
    description: 'Get learning loop data — aggregates outcome records vs projected scores to show model accuracy over time. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['learning loop data'],
    status: 'stable',
  },
  {
    id: 'MQC-API-060',
    label: 'GET /cortex/pipeline-positions',
    path: '/make-server-324f4fbe/cortex/pipeline-positions',
    type: 'API', domain: 'team-dashboard',
    description: 'Fetch saved kanban board card positions. Returns position map {submissionId → columnId}. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['positions map'],
    status: 'stable',
  },
  {
    id: 'MQC-API-061',
    label: 'POST /cortex/pipeline-positions',
    path: '/make-server-324f4fbe/cortex/pipeline-positions',
    type: 'API', domain: 'team-dashboard',
    description: 'Save kanban board card positions. Accepts single {submissionId, columnId} or bulk {positions: {...}}. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['saved positions'],
    status: 'stable',
  },
  {
    id: 'MQC-API-062',
    label: 'DELETE /cortex/pipeline-positions',
    path: '/make-server-324f4fbe/cortex/pipeline-positions',
    type: 'API', domain: 'team-dashboard',
    description: 'Reset all saved kanban board positions. Useful for debugging / full board reset. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['success'],
    status: 'stable',
  },
  {
    id: 'MQC-API-063',
    label: 'GET /cortex/column-capacities',
    path: '/make-server-324f4fbe/cortex/column-capacities',
    type: 'API', domain: 'team-dashboard',
    description: 'Fetch stored kanban column capacity limits. Returns {columnId → maxCards} map. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['column capacities map'],
    status: 'stable',
  },
  {
    id: 'MQC-API-064',
    label: 'PUT /cortex/column-capacities',
    path: '/make-server-324f4fbe/cortex/column-capacities',
    type: 'API', domain: 'team-dashboard',
    description: 'Save the full column capacity map. PUT replaces the entire map. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-008'],
    supplies: ['saved capacities'],
    status: 'stable',
  },
  // Path corrections for previously mis-labelled routes:
  {
    id: 'MQC-API-055-CORRECTED',
    label: 'POST /blocks/ai-assist ← was /cortex/block-assist',
    path: '/make-server-324f4fbe/blocks/ai-assist',
    type: 'API', domain: 'backend-ai',
    description: '⚠ PATH CORRECTION: actual path is /blocks/ai-assist (not /cortex/block-assist as previously documented). AI assistance for execution block descriptions. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-005'],
    supplies: ['suggestion text'],
    debugNotes: 'PATH WAS WRONG in v1.0 registry. Correct path: /make-server-324f4fbe/blocks/ai-assist. Update any hardcoded references.',
    status: 'watch',
  },
  {
    id: 'MQC-API-056-CORRECTED',
    label: 'POST /blocks/copilot-interpret ← was /cortex/copilot',
    path: '/make-server-324f4fbe/blocks/copilot-interpret',
    type: 'API', domain: 'backend-ai',
    description: '⚠ PATH CORRECTION: actual path is /blocks/copilot-interpret (not /cortex/copilot). Copilot interpretation endpoint. Team auth.',
    demands: ['MQC-BEF-001','MQC-BEF-006'],
    supplies: ['interpretation'],
    debugNotes: 'PATH WAS WRONG in v1.0 registry. Correct path: /make-server-324f4fbe/blocks/copilot-interpret.',
    status: 'watch',
  },
  {
    id: 'MQC-API-057-CORRECTED',
    label: 'POST /ai/chat ← was /cortex/chat',
    path: '/make-server-324f4fbe/ai/chat',
    type: 'API', domain: 'backend-ai',
    description: '⚠ PATH CORRECTION: actual path is /ai/chat (not /cortex/chat). CORTEX AI chat endpoint. Team auth. Multi-turn conversations with submission context.',
    demands: ['MQC-BEF-001','MQC-BEF-003'],
    supplies: ['chat response'],
    debugNotes: 'PATH WAS WRONG in v1.0 registry. Correct path: /make-server-324f4fbe/ai/chat. If GlobalAIChat (MQC-CMP-037) is not connecting, verify it uses /ai/chat not /cortex/chat.',
    status: 'watch',
  },
];

// ============================================================================
// V. REGISTRY VIEWER ITSELF (self-referential — MQC-CMP-091)
// ============================================================================

export const SELF_NODES: RegistryNode[] = [
  {
    id: 'MQC-CMP-091',
    label: 'RegistryViewer.tsx',
    path: '/src/app/components/RegistryViewer.tsx',
    type: 'CMP',
    domain: 'app-root',
    description: 'The System Registry Viewer UI — this very tool. Searchable, filterable view of all MQC node IDs. Available at route #/registry. Built with Eclipse dark theme. Features: search, type/status filters, dependency tracing (upstream + downstream), bug patterns panel, KV directory, stats panel.',
    demands: ['MQC-UTL-019'],
    supplies: ['RegistryViewer'],
    status: 'stable',
  },
  {
    id: 'MQC-UTL-019',
    label: 'registryData.ts',
    path: '/src/app/utils/registryData.ts',
    type: 'UTL',
    domain: 'app-root',
    description: 'Master registry manifest v1.0 — all node IDs, dependencies, descriptions, debug notes. Extended by registryDataExtension.ts (v1.1). Exports REGISTRY array, REGISTRY_BY_ID lookup, REGISTRY_STATS, KV_PREFIXES, BUG_PATTERNS, traceUpstream(), traceDownstream(), getDependencyPath().',
    demands: [],
    supplies: ['REGISTRY','REGISTRY_BY_ID','REGISTRY_STATS','KV_PREFIXES','BUG_PATTERNS','traceUpstream','traceDownstream','getDependencyPath'],
    status: 'stable',
  },
  {
    id: 'MQC-UTL-020',
    label: 'registryDataExtension.ts',
    path: '/src/app/utils/registryDataExtension.ts',
    type: 'UTL',
    domain: 'app-root',
    description: 'Registry extension v1.1 — adds all nodes missing from v1.0: 48 individual UI components, 2 protected files, 4 style files, 4 infra files, 6 doc files, 60 spec/import files, 16 backend functions, 6 missing API routes, API path corrections, self-referential nodes.',
    demands: ['MQC-UTL-019'],
    supplies: ['UI_INDIVIDUAL_NODES','PRO_NODES','STY_NODES','INF_NODES','DOC_NODES','SPC_NODES','FN_NODES','API_EXTENSION_NODES','SELF_NODES','EXTENSION_REGISTRY','FULL_REGISTRY'],
    status: 'stable',
  },
];

// ============================================================================
// EXTENSION REGISTRY — all new nodes combined
// ============================================================================

export const EXTENSION_REGISTRY: RegistryNode[] = [
  ...UI_INDIVIDUAL_NODES,
  ...PRO_NODES,
  ...STY_NODES,
  ...INF_NODES,
  ...DOC_NODES,
  ...SPC_NODES,
  ...FN_NODES,
  ...API_EXTENSION_NODES,
  ...SELF_NODES,
];

// ============================================================================
// EXTENDED TYPE META — color/label for new node types
// For use in RegistryViewer alongside the original TYPE_META
// ============================================================================

export const EXTENDED_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  FN:  { label: 'FUNCTION', color: '#E879F9', bg: 'rgba(232,121,249,0.12)' },
  STY: { label: 'STYLE',    color: '#67E8F9', bg: 'rgba(103,232,249,0.12)' },
  INF: { label: 'INFRA',    color: '#A3E635', bg: 'rgba(163,230,53,0.12)'  },
  DOC: { label: 'DOC',      color: '#FDE68A', bg: 'rgba(253,230,138,0.12)' },
  IMP: { label: 'IMPORT',   color: '#86EFAC', bg: 'rgba(134,239,172,0.12)' },
  PRO: { label: 'PROTECTED',color: '#CBD5E1', bg: 'rgba(203,213,225,0.12)' },
  SPC: { label: 'SPEC',     color: '#FDA4AF', bg: 'rgba(253,164,175,0.12)' },
};

// ============================================================================
// FULL REGISTRY — base + extension (import this to get everything)
// ============================================================================

import { REGISTRY } from './registryData';
export const FULL_REGISTRY: RegistryNode[] = [...REGISTRY, ...EXTENSION_REGISTRY];
export const FULL_REGISTRY_BY_ID: Record<string, RegistryNode> = Object.fromEntries(
  FULL_REGISTRY.map(n => [n.id, n])
);
export const FULL_REGISTRY_STATS = {
  total: FULL_REGISTRY.length,
  byType: FULL_REGISTRY.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {}),
  byStatus: FULL_REGISTRY.reduce<Record<string, number>>((acc, n) => {
    acc[n.status] = (acc[n.status] || 0) + 1;
    return acc;
  }, {}),
  byDomain: FULL_REGISTRY.reduce<Record<string, number>>((acc, n) => {
    acc[n.domain] = (acc[n.domain] || 0) + 1;
    return acc;
  }, {}),
};
