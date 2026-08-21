import type { ProfileData } from '@/lib/types';
import { Section, TextInput, Button, RepeatableCard } from './primitives';

type Education = ProfileData['education'][number];

const emptyEntry: Education = { institution: '', program: '', dates: '' };

export function EducationSection({
  value,
  onChange,
}: {
  value: ProfileData['education'];
  onChange: (v: ProfileData['education']) => void;
}) {
  const update = (i: number, entry: Education) =>
    onChange(value.map((e, idx) => (idx === i ? entry : e)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...emptyEntry }]);

  return (
    <Section
      title="Education & Degrees"
      badge={`${value.length} added`}
      description="University, degrees, diplomas, and relevant coursework."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
        </svg>
      }
    >
      <div className="space-y-3">
        {value.map((entry, i) => (
          <RepeatableCard
            key={i}
            label={
              entry.institution
                ? `${entry.institution}${entry.program ? ` — ${entry.program}` : ''}`
                : `Education #${i + 1}`
            }
            onRemove={() => remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextInput
                label="Institution / University"
                placeholder="e.g. Stanford University"
                value={entry.institution}
                onChange={(v) => update(i, { ...entry, institution: v })}
              />
              <TextInput
                label="Degree / Program"
                placeholder="e.g. B.S. Computer Science"
                value={entry.program}
                onChange={(v) => update(i, { ...entry, program: v })}
              />
              <TextInput
                label="Dates attended"
                placeholder="2019 – 2023"
                value={entry.dates}
                onChange={(v) => update(i, { ...entry, dates: v })}
              />
            </div>
          </RepeatableCard>
        ))}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          + Add education
        </Button>
      </div>
    </Section>
  );
}
