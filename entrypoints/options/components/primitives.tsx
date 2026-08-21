import type { ReactNode } from 'react';

// Shared form primitives for the options and settings page.
// Styled with modern SaaS tech aesthetics (Plus Jakarta Sans, subtle borders,
// indigo/violet accents, smooth micro-interactions).

export function Section({
  title,
  description,
  children,
  badge,
  icon,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  badge?: string;
  icon?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs transition-all hover:border-slate-300">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-2.5">
          {icon && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              {icon}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-slate-900">{title}</h2>
              {badge && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-semibold text-indigo-600 border border-indigo-200/50">
                  {badge}
                </span>
              )}
            </div>
            {description && (
              <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, string> = {
    primary:
      'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/20 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] border border-indigo-400/20',
    secondary:
      'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs active:scale-[0.98]',
    danger:
      'border border-red-200/80 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 shadow-2xs active:scale-[0.98]',
    ghost: 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 active:scale-[0.98]',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** A removable, indexed card for a single entry in a repeatable list. */
export function RepeatableCard({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 transition-all hover:border-slate-300">
      <div className="mb-3 flex items-center justify-between border-b border-slate-200/50 pb-2.5">
        <span className="text-xs font-bold text-slate-700 tracking-tight">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 transition-all"
        >
          Remove
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Editor for a list of plain strings (bullets, tech stack, avoid list, ...). */
export function StringListEditor({
  label,
  values,
  onChange,
  placeholder,
  addLabel = 'Add item',
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const update = (i: number, v: string) => {
    const next = values.slice();
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const add = () => onChange([...values, '']);

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={v}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-1.5 text-xs font-medium text-slate-900 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-red-200/70 bg-red-50 text-red-600 hover:bg-red-100 transition-all text-xs"
              title="Remove item"
            >
              ✕
            </button>
          </div>
        ))}
        {values.length === 0 && <p className="text-xs text-slate-400 italic">None added yet.</p>}
      </div>
      <div className="mt-2.5">
        <Button variant="secondary" onClick={add}>
          + {addLabel}
        </Button>
      </div>
    </div>
  );
}
