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
    <Section
      title="Work Experience & Roles"
      badge={`${value.length} roles`}
      description="Previous positions, achievements, and impact bullets used to tailor answers."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      }
    >
      <div className="space-y-3">
        {value.map((entry, i) => (
          <RepeatableCard
            key={i}
            label={
              entry.role
                ? `${entry.role}${entry.company ? ` @ ${entry.company}` : ''}`
                : `Experience #${i + 1}`
            }
            onRemove={() => remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextInput
                label="Company name"
                placeholder="e.g. Acme Corp"
                value={entry.company}
                onChange={(v) => update(i, { ...entry, company: v })}
              />
              <TextInput
                label="Job title / Role"
                placeholder="e.g. Senior Software Engineer"
                value={entry.role}
                onChange={(v) => update(i, { ...entry, role: v })}
              />
              <TextInput
                label="Dates active"
                placeholder="Jan 2022 – Present"
                value={entry.dates}
                onChange={(v) => update(i, { ...entry, dates: v })}
              />
            </div>
            <div className="pt-2 border-t border-slate-200/50">
              <StringListEditor
                label="Key achievements & bullet points"
                values={entry.bullets}
                placeholder="Led development of X, improving throughput by 40%..."
                addLabel="Add bullet point"
                onChange={(bullets) => update(i, { ...entry, bullets })}
              />
            </div>
          </RepeatableCard>
        ))}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          + Add work experience
        </Button>
      </div>
    </Section>
  );
}
