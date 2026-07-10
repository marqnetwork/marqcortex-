/**
 * ROLE SWITCHER — phase-p1-implementation.md §1
 *
 * Compact widget for switching the active user role in demo/dev mode.
 * Shows the current role pill with color + description.
 * Cycles through all five roles or expands to a dropdown.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, UserCog } from 'lucide-react';
import {
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  type UserRole,
} from '@/app/core/roleEngine';

const ALL_ROLES: UserRole[] = ['admin', 'strategist', 'finance', 'sales', 'viewer'];

interface RoleSwitcherProps {
  currentRole: UserRole;
  onChange:    (role: UserRole) => void;
  compact?:    boolean;
}

export function RoleSwitcher({ currentRole, onChange, compact = false }: RoleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const color = ROLE_COLORS[currentRole];

  return (
    <div ref={ref} className="relative">
      {/* Trigger pill */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition-colors"
        style={{
          background:  `${color}15`,
          borderColor: `${color}40`,
          color,
        }}
        title="Switch active role (demo / dev mode)"
      >
        <UserCog className="size-3 flex-shrink-0" />
        {!compact && (
          <span className="uppercase tracking-widest">{ROLE_LABELS[currentRole]}</span>
        )}
        {compact && (
          <span className="uppercase tracking-widest">{ROLE_LABELS[currentRole].slice(0, 3)}</span>
        )}
        <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 rounded-xl border overflow-hidden shadow-2xl"
          style={{
            background:  '#0D0D1E',
            borderColor: '#ffffff15',
            width:       '220px',
          }}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-white/5">
            <div className="text-[8px] font-black uppercase tracking-widest text-gray-700">
              Role (Demo Mode)
            </div>
            <div className="text-[7px] text-gray-800 mt-0.5">
              Permissions enforced per block type
            </div>
          </div>

          {/* Role options */}
          {ALL_ROLES.map(role => {
            const rColor   = ROLE_COLORS[role];
            const isActive = role === currentRole;
            return (
              <button
                key={role}
                onClick={() => { onChange(role); setOpen(false); }}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{
                  background: isActive ? `${rColor}10` : 'transparent',
                  borderLeft: isActive ? `2px solid ${rColor}` : '2px solid transparent',
                }}
              >
                <div
                  className="size-2 rounded-full flex-shrink-0 mt-1"
                  style={{ background: rColor }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[10px] font-bold"
                    style={{ color: isActive ? rColor : '#D1D5DB' }}
                  >
                    {ROLE_LABELS[role]}
                  </div>
                  <div className="text-[8px] text-gray-700 leading-tight mt-0.5">
                    {ROLE_DESCRIPTIONS[role]}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Footer note */}
          <div className="px-3 py-2 border-t border-white/5 text-[7px] text-gray-800">
            Role gates enforced at edit, AI assist, approve, and Copilot level.
          </div>
        </div>
      )}
    </div>
  );
}
