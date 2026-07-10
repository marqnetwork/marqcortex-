/**
 * LOADING SKELETONS — Reusable shimmer/pulse skeleton primitives
 * and pre-composed skeletons for common page layouts.
 *
 * Uses the Eclipse dark theme (#0A0A0F base) with subtle pulse animations.
 */

import { type ReactNode } from 'react';

// ── Primitive ────────────────────────────────────────────────────────────────

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Low-level pulse bar. Apply w/h via className. */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`}
      style={style}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Circle variant (avatar, icon). */
export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return (
    <div
      className="animate-pulse rounded-full bg-white/[0.06] flex-shrink-0"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

// ── Composed: Card Grid ──────────────────────────────────────────────────────

export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-5 rounded-xl border border-white/[0.06] bg-black/30">
          <Skeleton className="h-3 w-16 mb-3" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-2 w-12" />
        </div>
      ))}
    </div>
  );
}

// ── Composed: Table ──────────────────────────────────────────────────────────

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden bg-black/30">
      {/* Header */}
      <div className="flex gap-4 px-5 py-3 border-b border-white/[0.04]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.03] last:border-0">
          <SkeletonCircle size={32} />
          {Array.from({ length: cols - 1 }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Composed: Dashboard overview ─────────────────────────────────────────────

export function SkeletonDashboard() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Top bar */}
      <div className="border-b border-white/[0.06] bg-black/40 px-6 py-5">
        <div className="max-w-[1400px] mx-auto flex items-center gap-4">
          <Skeleton className="h-8 w-48" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        {/* Stat cards */}
        <SkeletonCardGrid count={4} />

        {/* Content area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SkeletonTable rows={6} cols={5} />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 rounded-xl border border-white/[0.06] bg-black/30">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-12 w-full mb-2" />
                <Skeleton className="h-2 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Composed: Client portal ──────────────────────────────────────────────────

export function SkeletonClientPortal() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-black/40 px-6 py-6">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-8 w-64 mb-3" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Score card */}
        <div className="p-8 rounded-2xl border border-white/[0.06] bg-black/30 text-center">
          <Skeleton className="h-24 w-24 rounded-full mx-auto mb-4" />
          <Skeleton className="h-6 w-48 mx-auto mb-2" />
          <Skeleton className="h-3 w-64 mx-auto" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 rounded-lg" />
          ))}
        </div>

        {/* Content */}
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-6 rounded-xl border border-white/[0.06] bg-black/30">
              <Skeleton className="h-5 w-48 mb-4" />
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-3 w-5/6 mb-2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Composed: Form / Diagnostic ──────────────────────────────────────────────

export function SkeletonForm() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        {/* Progress bar */}
        <Skeleton className="h-1 w-full rounded-full mb-8" />

        <div className="p-8 rounded-2xl border border-white/[0.06] bg-black/30 space-y-6">
          <Skeleton className="h-6 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2 mb-6" />

          {/* Form fields */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ))}

          {/* Buttons */}
          <div className="flex justify-between pt-4">
            <Skeleton className="h-10 w-24 rounded-xl" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wrapper: suspense-style container ────────────────────────────────────────

interface LoadingWrapperProps {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}

export function LoadingWrapper({ loading, skeleton, children }: LoadingWrapperProps) {
  return loading ? <span className="contents">{skeleton}</span> : <span className="contents">{children}</span>;
}