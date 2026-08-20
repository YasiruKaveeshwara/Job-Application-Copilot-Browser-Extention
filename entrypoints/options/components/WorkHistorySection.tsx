import type { ProfileData } from '@/lib/types';
import { Section, TextInput, Button, RepeatableCard, StringListEditor } from './primitives';

type Work = ProfileData['workHistory'][number];

const emptyEntry: Work = { company: '', role: '', dates: '', bullets: [] };

export function WorkHistorySection({
  value,
  onChange,
}: {
  value: ProfileData['workHistory'];
  onChange: (v: ProfileData['workHistory']) => void;
}) {
  const update = (i: number, entry: Work) =>
    onChange(value.map((e, idx) => (idx === i ? entry : e)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...emptyEntry, bullets: [] }]);

  return (
    <Section title="Work history">
      {value.map((entry, i) => (
        <RepeatableCard key={i} label={`Role ${i + 1}`} onRemove={() => remove(i)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput
              label="Company"
              value={entry.company}
              onChange={(v) => update(i, { ...entry, company: v })}
            />
            <TextInput
              label="Role"
              value={entry.role}
              onChange={(v) => update(i, { ...entry, role: v })}
            />
            <TextInput
              label="Dates"
              placeholder="Jan 2022 – present"
              value={entry.dates}
              onChange={(v) => update(i, { ...entry, dates: v })}
            />
          </div>
          <StringListEditor
            label="Bullets"
            values={entry.bullets}
            placeholder="Shipped X, improving Y by Z%"
            addLabel="Add bullet"
            onChange={(bullets) => update(i, { ...entry, bullets })}
          />
        </RepeatableCard>
      ))}
      <Button onClick={add}>Add role</Button>
    </Section>
  );
}
