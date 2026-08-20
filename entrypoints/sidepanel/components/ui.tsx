import type { ReactNode } from 'react';

// Small styled bits used only by the review panel. The panel is a ~360px column
// with disabled states on nearly every action, which the options page's
// primitives don't cover, so it keeps its own rather than widening those.

const BUTTON_VARIANTS = {
  primary: 'bg-gray-900 text-white hover:bg-gray-700',
  secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
} as const;

export function PanelButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}

const BADGE_TONES = {
  neutral: 'bg-gray-100 text-gray-600',
  warn: 'bg-amber-100 text-amber-800',
  ok: 'bg-emerald-100 text-emerald-800',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const BANNER_TONES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-gray-200 bg-gray-50 text-gray-700',
} as const;

export function Banner({
  tone,
  title,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-md border p-3 text-xs ${BANNER_TONES[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 space-y-1">{children}</div>}
    </div>
  );
}
