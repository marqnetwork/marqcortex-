/**
 * NOT FOUND (404) — Branded 404 page matching MARQ Cortex Eclipse theme
 */

import { useNavigate } from 'react-router';
import { Home, ArrowLeft, Search, Zap } from 'lucide-react';

const PURPLE = '#8B5CF6';
const BLUE = '#3B82F6';
const CYAN = '#06D7F6';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-6 relative overflow-hidden" role="main" aria-label="Page not found">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-10"
          style={{ background: PURPLE, top: '-20%', right: '-10%' }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full blur-[100px] opacity-8"
          style={{ background: BLUE, bottom: '-15%', left: '-5%' }}
        />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-lg w-full text-center">
        {/* 404 glitch text */}
        <div className="relative mb-8">
          <h1
            className="text-[160px] sm:text-[200px] font-black leading-none tracking-tighter select-none"
            style={{
              background: `linear-gradient(135deg, ${PURPLE}, ${BLUE}, ${CYAN})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              opacity: 0.15,
            }}
          >
            404
          </h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div
                className="size-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{
                  background: `linear-gradient(135deg, ${PURPLE}20, ${BLUE}20)`,
                  border: `1px solid ${PURPLE}30`,
                }}
              >
                <Search className="size-7" style={{ color: PURPLE }} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                Page Not Found
              </h2>
            </div>
          </div>
        </div>

        <p className="text-white/50 text-base leading-relaxed mb-10 max-w-md mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm transition-all hover:opacity-90"
            style={{
              background: `linear-gradient(135deg, ${PURPLE}, ${BLUE})`,
            }}
          >
            <Home className="size-4" />
            Back to Home
          </button>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white/70 font-semibold text-sm transition-all hover:bg-white/10 bg-white/5 border border-white/10"
          >
            <ArrowLeft className="size-4" />
            Go Back
          </button>
        </div>

        {/* Quick links */}
        <div className="border-t border-white/10 pt-8">
          <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-4">Quick Links</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              { label: 'Get Started', path: '/get-started' },
              { label: 'Diagnostic', path: '/diagnostic' },
              { label: 'Team Login', path: '/team/login' },
              { label: 'Client Portal', path: '/client/login' },
            ].map((link) => (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs font-medium hover:bg-white/10 hover:text-white/80 transition-all"
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>

        {/* Branding */}
        <div className="mt-12 flex items-center justify-center gap-2 text-white/20">
          <Zap className="size-4" style={{ color: `${PURPLE}60` }} />
          <span className="text-xs font-semibold tracking-wider">MARQ CORTEX</span>
        </div>
      </div>
    </div>
  );
}