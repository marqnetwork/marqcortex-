/**
 * The icon for each navigation entry.
 *
 * Kept out of `@/app/core/orientation` on purpose: that module is pure and is
 * imported directly by the Node test suites, and an icon is a React component.
 * The model owns what the entries ARE; this owns what they look like.
 *
 * Keyed by the same page id the shell switches on, so a missing icon is a
 * missing key rather than a mismatched list — `navIconFor` falls back to a
 * neutral glyph rather than rendering nothing.
 */
import {
  LayoutDashboard, Brain, Users, Settings, Shield, BarChart3, Mail,
  TrendingUp, Zap, GitBranch, Cpu, Circle,
  type LucideIcon,
} from 'lucide-react';

export const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  dashboard: LayoutDashboard,
  cortex: Brain,
  execution: Zap,
  reviewer: Shield,
  analytics: BarChart3,
  revenue: TrendingUp,
  emails: Mail,
  team: Users,
  settings: Settings,
  mapping: GitBranch,
  architecture: Cpu,
};

export function navIconFor(id: string): LucideIcon {
  return NAV_ICONS[id] ?? Circle;
}
