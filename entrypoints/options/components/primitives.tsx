import type { ReactNode } from 'react';

// Shared, unstyled-ish form primitives for the options page. Tailwind classes
// keep everything consistent; no external UI library for the MVP.

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  const styles: Record<string, string> = {
    primary: 'bg-gray-900 text-white hover:bg-gray-700',
    secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${styles[variant]}`}
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
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <Button variant="danger" onClick={onRemove}>
          Remove
        </Button>
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
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={v}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            <Button variant="danger" onClick={() => remove(i)}>
              ✕
            </Button>
          </div>
        ))}
        {values.length === 0 && <p className="text-xs text-gray-400">None yet.</p>}
      </div>
      <div className="mt-2">
        <Button onClick={add}>{addLabel}</Button>
      </div>
    </div>
  );
}
