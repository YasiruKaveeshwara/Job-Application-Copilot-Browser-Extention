import type { ReactNode } from 'react';

// Premium styled UI primitives for the review panel.
// Designed with a sleek, modern tech aesthetic (indigo/violet accents, crisp
// typography, smooth micro-interactions).

const BUTTON_VARIANTS = {
  primary:
    'bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/20 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] border border-indigo-400/20',
  secondary:
    'border border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs active:scale-[0.98]',
  ghost: 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 active:scale-[0.98]',
  emerald:
    'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98]',
} as const;

export function PanelButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200/60',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
  warn: 'bg-amber-50 text-amber-800 border-amber-200/80',
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
  purple: 'bg-purple-50 text-purple-700 border-purple-200/80',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-wide ${BADGE_TONES[tone]}`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tone === 'ok'
              ? 'bg-emerald-500'
              : tone === 'warn'
                ? 'bg-amber-500'
                : tone === 'indigo'
                  ? 'bg-indigo-500'
                  : 'bg-slate-400'
          }`}
        />
      )}
      {children}
    </span>
  );
}

const BANNER_TONES = {
  error: 'border-red-200/80 bg-red-50/90 text-red-900 shadow-2xs',
  warn: 'border-amber-200/80 bg-amber-50/90 text-amber-900 shadow-2xs',
  info: 'border-slate-200/80 bg-white/90 text-slate-700 shadow-2xs',
  gradient:
    'border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 text-slate-800 shadow-2xs',
} as const;

export function Banner({
  tone,
  title,
  children,
  icon,
}: {
  tone: keyof typeof BANNER_TONES;
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 text-xs backdrop-blur-xs transition-all ${BANNER_TONES[tone]}`}
    >
      <div className="flex items-start gap-2">
        {icon && <div className="mt-0.5 shrink-0 text-current">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="font-bold tracking-tight text-slate-900">{title}</p>
          {children && (
            <div className="mt-1 space-y-1 text-slate-600 leading-relaxed">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
