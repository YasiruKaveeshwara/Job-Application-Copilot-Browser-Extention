import type { ReactNode } from 'react';

// Shared form primitives for the options and settings page.
// Design language: calm futuristic workspace — light surfaces, blue accents, clear hierarchy.

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
    <section className="overflow-hidden rounded-[22px] border border-[#dbe7f3] bg-white shadow-[0_8px_28px_rgba(27,78,125,0.06)] transition-all hover:border-blue-200 hover:shadow-[0_12px_34px_rgba(27,111,190,0.1)]">
      {/* Section header */}
      <div className="flex items-start gap-3 border-b border-blue-50 bg-gradient-to-r from-[#f7fbff] to-white px-5 py-4">
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100 text-blue-600">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold tracking-tight text-[#10233f]">{title}</h2>
            {badge && (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-4 p-5">{children}</div>
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
        className="w-full rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] px-3.5 py-2.5 text-[12px] font-medium text-slate-900 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 hover:border-blue-200"
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
        className="w-full resize-none rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] px-3.5 py-2.5 text-[12px] font-medium text-slate-900 placeholder:text-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 hover:border-blue-200"
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
      'bg-[#0b6fe4] text-white shadow-sm shadow-blue-500/25 hover:bg-[#1683f5] active:bg-[#0959b8] active:scale-[0.98] border border-blue-500/40',
    secondary:
      'border border-[#dbe7f3] bg-white text-slate-700 hover:bg-blue-50 hover:border-blue-200 shadow-sm active:scale-[0.98]',
    danger:
      'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 shadow-xs active:scale-[0.98]',
    ghost: 'text-slate-600 hover:bg-blue-50 hover:text-blue-700 active:scale-[0.98]',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-2xl px-3.5 py-2 text-xs font-semibold tracking-tight transition-all duration-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${styles[variant]} ${className}`}
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
    <div className="rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] p-4 transition-all hover:border-blue-200">
      <div className="mb-3 flex items-center justify-between border-b border-slate-200/60 pb-2.5">
        <span className="text-xs font-bold text-slate-700 tracking-tight">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 hover:text-red-700 transition-all"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
              clipRule="evenodd"
            />
          </svg>
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
      <span className="mb-2 block text-xs font-semibold text-slate-700">{label}</span>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={v}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="w-full rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] px-3.5 py-2 text-[12px] font-medium text-slate-900 shadow-sm transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 hover:border-blue-200"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 hover:bg-red-50 hover:border-red-300 transition-all"
              title="Remove item"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        ))}
        {values.length === 0 && (
          <p className="text-[11px] text-slate-400 italic py-1">None added yet.</p>
        )}
      </div>
      <div className="mt-2.5">
        <Button variant="secondary" onClick={add}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
