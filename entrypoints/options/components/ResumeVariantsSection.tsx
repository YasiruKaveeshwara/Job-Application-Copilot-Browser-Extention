import type { ProfileData } from '@/lib/types';
import { Section, TextInput, Button, RepeatableCard } from './primitives';

type Resume = ProfileData['resumeVariants'][number];

const emptyEntry: Resume = { label: '', fileRef: '' };

export function ResumeVariantsSection({
  value,
  onChange,
}: {
  value: ProfileData['resumeVariants'];
  onChange: (v: ProfileData['resumeVariants']) => void;
}) {
  const update = (i: number, entry: Resume) =>
    onChange(value.map((e, idx) => (idx === i ? entry : e)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...emptyEntry }]);

  return (
    <Section
      title="Resume Variants & Target Roles"
      badge={`${value.length} variants`}
      description="Different versions of your CV tailored for specific specializations (e.g. Frontend vs. Fullstack)."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      }
    >
      <div className="space-y-3">
        {value.map((entry, i) => (
          <RepeatableCard
            key={i}
            label={entry.label ? `Variant: ${entry.label}` : `Resume Variant #${i + 1}`}
            onRemove={() => remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Variant label"
                placeholder="e.g. Backend-focused"
                value={entry.label}
                onChange={(v) => update(i, { ...entry, label: v })}
              />
              <TextInput
                label="File reference or note"
                placeholder="e.g. resume-backend.pdf"
                value={entry.fileRef}
                onChange={(v) => update(i, { ...entry, fileRef: v })}
              />
            </div>
          </RepeatableCard>
        ))}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          + Add resume variant
        </Button>
      </div>
    </Section>
  );
}
