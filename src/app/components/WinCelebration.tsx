/**
 * CORTEX WIN CELEBRATION — Phase 7A
 *
 * Full-screen celebration overlay that fires when a card is confirmed as
 * "Converted" in the Pipeline Kanban board.
 *
 * Features:
 *  - 80-particle confetti (CSS keyframes, no external lib)
 *  - Count-up animations for deal value, revenue, conversion rate
 *  - "Learning Loop Updated" pulse badge
 *  - Auto-dismiss (6 s) with shrinking progress bar
 *  - Spring-physics entry / exit via Motion
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, TrendingUp, DollarSign, Zap, Target, Award, Sparkles, Brain } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WinCelebrationData {
  companyName: string;
  industry?: string;
  dealValue: number | null;
  previousRevenue: number;
  newRevenue: number;
  totalWins: number;
  conversionRate: number | null;
}

interface WinCelebrationProps extends WinCelebrationData {
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 6000;
const CONFETTI_COUNT = 90;
const CONFETTI_COLORS = [
  '#8B5CF6', '#7C3AED',   // purple
  '#3B82F6', '#2563EB',   // blue
  '#06D7F6', '#0EA5E9',   // cyan
  '#10B981', '#059669',   // green
  '#FB923C', '#F59E0B',   // orange / amber
  '#EC4899',              // pink
  '#F1F5F9',              // near-white
];

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, durationMs = 1400, delayMs = 400): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const start = Date.now();
      const tick = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / durationMs, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setVal(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delayMs);
    return () => clearTimeout(t);
  }, [target, durationMs, delayMs]);
  return val;
}

// ── Confetti particle data ────────────────────────────────────────────────────

interface ConfettiPiece {
  id: number;
  left: string;
  color: string;
  width: number;
  height: number;
  delay: number;
  duration: number;
  initialRotation: number;
  shape: 'circle' | 'rect' | 'diamond';
}

function useConfetti(count: number): ConfettiPiece[] {
  return useMemo(() => {
    const shapes: ConfettiPiece['shape'][] = ['circle', 'rect', 'diamond'];
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      width: Math.random() * 9 + 5,
      height: Math.random() * 7 + 5,
      delay: Math.random() * 3.5,
      duration: Math.random() * 2.5 + 2,
      initialRotation: Math.random() * 360,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    }));
  }, [count]);
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatRevenue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function WinCelebration({
  companyName,
  industry,
  dealValue,
  previousRevenue,
  newRevenue,
  totalWins,
  conversionRate,
  onClose,
}: WinCelebrationProps) {
  const confettiPieces = useConfetti(CONFETTI_COUNT);

  // Animated counters
  const animatedDealValue  = useCountUp(dealValue ?? 0, 1600, 300);
  const animatedRevenue    = useCountUp(newRevenue, 1800, 500);
  const animatedWins       = useCountUp(totalWins, 1000, 400);
  const animatedConvRate   = useCountUp(conversionRate ?? 0, 1400, 600);

  // Auto-dismiss
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onClose]);

  // Click-outside backdrop dismiss
  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <span className="contents">
      {/* Confetti + keyframe injection */}
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-40px) rotate(var(--ir)) scaleX(1);    opacity: 1; }
          50%  { transform: translateY(45vh)  rotate(calc(var(--ir) + 360deg)) scaleX(-1); opacity: 0.9; }
          100% { transform: translateY(110vh) rotate(calc(var(--ir) + 720deg)) scaleX(1);  opacity: 0; }
        }
        @keyframes win-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
          50%       { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
        }
        @keyframes win-glow-ring {
          0%   { opacity: 0.6; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.6); }
        }
      `}</style>

      {/* Overlay root */}
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.88)' }}
        onClick={handleBackdropClick}
      >
        {/* ── Confetti layer (pointer-events-none) ─────────────────────────── */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {confettiPieces.map(p => (
            <div
              key={p.id}
              className="absolute top-0"
              style={{
                left: p.left,
                width: `${p.width}px`,
                height: `${p.height}px`,
                background: p.color,
                borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'diamond' ? '2px' : '2px',
                transform: p.shape === 'diamond' ? 'rotate(45deg)' : 'none',
                // @ts-ignore
                '--ir': `${p.initialRotation}deg`,
                animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
                opacity: 0,
              }}
            />
          ))}
        </div>

        {/* ── Central celebration card ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 32 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{   opacity: 0, scale: 0.92,  y: 16 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="relative w-full max-w-[520px] rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #0F1020 0%, #090910 100%)',
            border: '1.5px solid rgba(16,185,129,0.4)',
            boxShadow: '0 32px 96px rgba(0,0,0,0.8), 0 0 60px rgba(16,185,129,0.12)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Ambient glow rings */}
          <div
            className="absolute -top-16 left-1/2 -translate-x-1/2 size-48 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(16,185,129,0.18) 0%, transparent 70%)',
              animation: 'win-glow-ring 2.5s ease-out 0.5s forwards',
            }}
          />

          {/* ── Header bar ───────────────────────────────────────────────── */}
          <div
            className="relative px-6 pt-6 pb-5"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.14) 0%, transparent 70%)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* Trophy icon + title */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Pulsing trophy */}
                <div
                  className="relative size-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(16,185,129,0.18)',
                    border: '1.5px solid rgba(16,185,129,0.45)',
                    animation: 'win-pulse 1.8s ease-in-out infinite',
                  }}
                >
                  <Award className="size-7 text-[#10B981]" />
                  {/* Sparkle in corner */}
                  <Sparkles className="absolute -top-1.5 -right-1.5 size-3.5 text-[#F59E0B]" />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md"
                      style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981', border: '1px solid rgba(16,185,129,0.35)' }}
                    >
                      Win Confirmed
                    </span>
                    <span className="text-lg">🎉</span>
                  </div>
                  <h2 className="text-xl font-black text-white leading-tight">{companyName}</h2>
                  {industry && (
                    <p className="text-xs text-gray-500 mt-0.5">{industry}</p>
                  )}
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="size-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-white transition-colors flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* ── Deal Value hero ───────────────────────────────────────────── */}
          <div className="px-6 pt-6 pb-4 text-center">
            {dealValue && dealValue > 0 ? (
              <span className="contents">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-1">Deal Value</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-black text-[#10B981]">$</span>
                  <motion.span
                    className="text-6xl font-black text-white tabular-nums"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                  >
                    {animatedDealValue.toLocaleString()}
                  </motion.span>
                </div>
                <p className="text-xs text-gray-600 mt-1">added to pipeline revenue</p>
              </span>
            ) : (
              <span className="contents">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">Outcome</p>
                <div
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl"
                  style={{ background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.35)' }}
                >
                  <TrendingUp className="size-6 text-[#10B981]" />
                  <span className="text-3xl font-black text-[#10B981]">Deal Won</span>
                </div>
              </span>
            )}
          </div>

          {/* ── Stats row ─────────────────────────────────────────────────── */}
          <div
            className="mx-6 mb-5 grid grid-cols-3 gap-3 rounded-xl p-4"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {/* Total Revenue */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <DollarSign className="size-3 text-[#06D7F6]" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Revenue</span>
              </div>
              <motion.div
                className="text-lg font-black text-[#06D7F6] tabular-nums"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {formatRevenue(animatedRevenue)}
              </motion.div>
              {previousRevenue > 0 && (
                <div className="text-[10px] text-gray-700 mt-0.5">
                  was {formatRevenue(previousRevenue)}
                </div>
              )}
            </div>

            {/* Conversion Rate */}
            <div className="text-center border-x" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-center gap-1 mb-1">
                <Target className="size-3 text-[#FB923C]" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Conv. Rate</span>
              </div>
              <motion.div
                className="text-lg font-black text-[#FB923C] tabular-nums"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                {conversionRate !== null ? `${animatedConvRate}%` : '–'}
              </motion.div>
              <div className="text-[10px] text-gray-700 mt-0.5">of all leads</div>
            </div>

            {/* Total Wins */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Award className="size-3 text-[#8B5CF6]" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total Wins</span>
              </div>
              <motion.div
                className="text-lg font-black text-[#8B5CF6] tabular-nums"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
              >
                {animatedWins}
              </motion.div>
              <div className="text-[10px] text-gray-700 mt-0.5">logged</div>
            </div>
          </div>

          {/* ── Learning Loop badge ───────────────────────────────────────── */}
          <motion.div
            className="mx-6 mb-5 flex items-center gap-3 rounded-xl px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(6,215,246,0.06))',
              border: '1px solid rgba(139,92,246,0.25)',
            }}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8, type: 'spring', stiffness: 280, damping: 24 }}
          >
            <div
              className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)' }}
            >
              <Brain className="size-4 text-[#8B5CF6]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">CORTEX Learning Loop Updated</span>
                {/* Live pulse dot */}
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#8B5CF6' }} />
                  <span className="relative inline-flex rounded-full size-2" style={{ background: '#8B5CF6' }} />
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                Win data + deal value ingested · Recommendation accuracy recalculated · Insights panel refreshed
              </p>
            </div>
            <Zap className="size-4 text-[#8B5CF6] flex-shrink-0 opacity-60" />
          </motion.div>

          {/* ── Auto-dismiss progress bar + hint ─────────────────────────── */}
          <div className="px-6 pb-5">
            {/* Progress track */}
            <div
              className="rounded-full overflow-hidden mb-2"
              style={{ height: '3px', background: 'rgba(255,255,255,0.07)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: 'linear-gradient(90deg, #10B981, #8B5CF6)',
                  boxShadow: '0 0 8px rgba(16,185,129,0.5)',
                }}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: AUTO_DISMISS_MS / 1000, ease: 'linear' }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-700">Auto-closing · click backdrop to dismiss</span>
              <button
                onClick={onClose}
                className="text-[11px] text-gray-600 hover:text-[#10B981] transition-colors font-medium"
              >
                Close now →
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </span>
  );
}