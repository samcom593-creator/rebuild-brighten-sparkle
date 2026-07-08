/**
 * APEX design tokens — single source of truth for palette, radius, spacing.
 * Consumed by every rebuilt page (Applicants, Unlicensed, License Push, Producer Risk, etc.).
 */

export const APEX_TOKENS = {
  bg: {
    app: '#05070A',
    main: '#070A0F',
    sidebar: '#060A10',
    surface: '#0B1118',
    elevated: '#111A24',
    card: '#101720',
    softPanel: 'rgba(255,255,255,0.04)',
  },
  border: {
    default: 'rgba(255,255,255,0.08)',
    strong: 'rgba(255,255,255,0.14)',
    teal: 'rgba(25,211,181,0.45)',
    gold: 'rgba(245,185,66,0.45)',
    red: 'rgba(239,68,68,0.45)',
  },
  text: {
    primary: '#F5F7FA',
    secondary: '#A8B3C5',
    muted: '#6F7A8C',
    disabled: '#444C5A',
  },
  accent: {
    teal: '#19D3B5',
    tealDark: '#0E8F7C',
    gold: '#F5B942',
    amber: '#F59E0B',
    red: '#EF4444',
    rose: '#F43F5E',
    green: '#22C55E',
    blue: '#38BDF8',
    purple: '#A855F7',
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 18,
    xl: 24,
    full: 9999,
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
  },
} as const;

/** Convert a #rrggbb hex to rgba(r,g,b,alpha). Accepts optional leading '#'. */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export type ToneKind =
  | 'critical'
  | 'hot'
  | 'today'
  | 'watch'
  | 'low'
  | 'suppressed';

export interface ToneClasses {
  bg: string;
  text: string;
  border: string;
  ring: string;
}

/**
 * Returns Tailwind class-name strings for a priority tone.
 * critical=rose, hot=amber, today=teal, watch=blue, low=slate, suppressed=slate-muted.
 */
export function tone(kind: ToneKind): ToneClasses {
  switch (kind) {
    case 'critical':
      return {
        bg: 'bg-rose-500/15',
        text: 'text-rose-300',
        border: 'border-rose-500/40',
        ring: 'ring-rose-500/30',
      };
    case 'hot':
      return {
        bg: 'bg-amber-500/15',
        text: 'text-amber-300',
        border: 'border-amber-500/40',
        ring: 'ring-amber-500/30',
      };
    case 'today':
      return {
        bg: 'bg-teal-500/15',
        text: 'text-teal-300',
        border: 'border-teal-500/40',
        ring: 'ring-teal-500/30',
      };
    case 'watch':
      return {
        bg: 'bg-blue-500/15',
        text: 'text-blue-300',
        border: 'border-blue-500/40',
        ring: 'ring-blue-500/30',
      };
    case 'low':
      return {
        bg: 'bg-slate-500/15',
        text: 'text-slate-300',
        border: 'border-slate-500/40',
        ring: 'ring-slate-500/30',
      };
    case 'suppressed':
      return {
        bg: 'bg-slate-800/40',
        text: 'text-slate-500',
        border: 'border-slate-700/40',
        ring: 'ring-slate-700/20',
      };
  }
}
