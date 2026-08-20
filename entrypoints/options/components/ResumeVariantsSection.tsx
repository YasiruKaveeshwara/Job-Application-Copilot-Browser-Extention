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
      title="Resume variants"
      description="File references only for the MVP — no upload handling yet."
    >
      {value.map((entry, i) => (
        <RepeatableCard key={i} label={`Variant ${i + 1}`} onRemove={() => remove(i)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Label"
              placeholder="Backend-focused"
              value={entry.label}
              onChange={(v) => update(i, { ...entry, label: v })}
            />
            <TextInput
              label="File reference"
              placeholder="resume-backend.pdf"
              value={entry.fileRef}
              onChange={(v) => update(i, { ...entry, fileRef: v })}
            />
          </div>
        </RepeatableCard>
      ))}
      <Button onClick={add}>Add resume variant</Button>
    </Section>
  );
}
