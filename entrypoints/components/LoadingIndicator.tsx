import type { ReactNode } from 'react';

/**
 * A compact loading treatment shared by the full-page options UI and side panel.
 * The staggered bars feel active without the old centered spinner taking over
 * the layout.
 */
export function LoadingIndicator({
  label,
  size = 'md',
}: {
  label?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { wrapper: 'h-3.5', bar: 'h-2.5 w-0.5', gap: 'gap-0.5' },
    md: { wrapper: 'h-5', bar: 'h-3.5 w-1', gap: 'gap-1' },
    lg: { wrapper: 'h-7', bar: 'h-5 w-1.5', gap: 'gap-1.5' },
  }[size];

  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span className={`inline-flex items-center ${sizes.gap} ${sizes.wrapper}`} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`${sizes.bar} rounded-full bg-current loading-bar`}
            style={{ animationDelay: `${index * 110}ms` }}
          />
        ))}
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}
