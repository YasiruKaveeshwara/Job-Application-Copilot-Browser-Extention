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
    <Section title="Education">
      {value.map((entry, i) => (
        <RepeatableCard key={i} label={`Entry ${i + 1}`} onRemove={() => remove(i)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput
              label="Institution"
              value={entry.institution}
              onChange={(v) => update(i, { ...entry, institution: v })}
            />
            <TextInput
              label="Program"
              value={entry.program}
              onChange={(v) => update(i, { ...entry, program: v })}
            />
            <TextInput
              label="Dates"
              placeholder="2019 – 2023"
              value={entry.dates}
              onChange={(v) => update(i, { ...entry, dates: v })}
            />
          </div>
        </RepeatableCard>
      ))}
      <Button onClick={add}>Add education</Button>
    </Section>
  );
}
