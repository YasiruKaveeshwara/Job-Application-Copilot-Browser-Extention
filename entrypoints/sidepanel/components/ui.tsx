import type { ReactNode } from 'react';

// Premium UI primitives for the sidepanel — sharp, modern, pixel-perfect.
// Design language: crisp borders, tight spacing, subtle depth, indigo/violet system.

const BUTTON_VARIANTS = {
  primary:
    'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 hover:bg-indigo-500 active:bg-indigo-700 active:scale-[0.97] border border-indigo-500/50',
  secondary:
    'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-xs active:scale-[0.97]',
  ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 active:scale-[0.97]',
  emerald:
    'bg-emerald-600 text-white shadow-sm shadow-emerald-500/25 hover:bg-emerald-500 active:scale-[0.97] border border-emerald-500/40',
  danger:
    'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 active:scale-[0.97]',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold tracking-tight transition-all duration-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100 ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  red: 'bg-red-50 text-red-700 border-red-200',
} as const;

const BADGE_DOT_COLORS = {
  neutral: 'bg-slate-400',
  indigo: 'bg-indigo-500',
  warn: 'bg-amber-500',
  ok: 'bg-emerald-500',
  purple: 'bg-violet-500',
  red: 'bg-red-500',
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
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${BADGE_TONES[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT_COLORS[tone]}`} />}
      {children}
    </span>
  );
}

const BANNER_TONES = {
  error: 'border-red-200 bg-red-50 text-red-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  gradient: 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50/60 text-slate-800',
} as const;

const BANNER_ICONS = {
  error: (
    <svg
      className="h-3.5 w-3.5 text-red-500 shrink-0 mt-px"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  ),
  warn: (
    <svg
      className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  ),
  info: (
    <svg
      className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-px"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
        clipRule="evenodd"
      />
    </svg>
  ),
  gradient: null,
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
  const autoIcon = BANNER_ICONS[tone];
  return (
    <div className={`rounded-xl border py-1 px-2 text-xs transition-all ${BANNER_TONES[tone]}`}>
      <div className="flex items-start gap-2">
        {icon ? (
          <div className="mt-0.5 shrink-0 text-current">{icon}</div>
        ) : (
          autoIcon && <div className="mt-0.5">{autoIcon}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-current">{title}</p>
          {children && <div className="mt-1 space-y-1 opacity-85 leading-relaxed">{children}</div>}
        </div>
      </div>
    </div>
  );
}

/** Divider with optional label */
export function Divider({ label }: { label?: string }) {
  if (!label) {
    return <hr className="border-slate-100" />;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-slate-100" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        {label}
      </span>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}
