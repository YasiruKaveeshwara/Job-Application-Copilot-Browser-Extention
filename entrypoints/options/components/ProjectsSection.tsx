import type { ProfileData } from '@/lib/types';
import {
  Section,
  TextInput,
  TextArea,
  Button,
  RepeatableCard,
  StringListEditor,
} from './primitives';

type Project = ProfileData['projects'][number];

const emptyEntry: Project = {
  name: '',
  description: '',
  individualOrGroup: 'individual',
  techStack: [],
  narrativeFragments: [],
};

export function ProjectsSection({
  value,
  onChange,
}: {
  value: ProfileData['projects'];
  onChange: (v: ProfileData['projects']) => void;
}) {
  const update = (i: number, entry: Project) =>
    onChange(value.map((e, idx) => (idx === i ? entry : e)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...emptyEntry, techStack: [], narrativeFragments: [] }]);

  return (
    <Section
      title="Projects"
      description="Individual vs. group is explicit — it changes how answers are phrased."
    >
      {value.map((entry, i) => (
        <RepeatableCard key={i} label={`Project ${i + 1}`} onRemove={() => remove(i)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Name"
              value={entry.name}
              onChange={(v) => update(i, { ...entry, name: v })}
            />
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-gray-700">
                Individual or group?
              </legend>
              <div className="flex gap-4 pt-1">
                {(['individual', 'group'] as const).map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="radio"
                      name={`project-${i}-type`}
                      checked={entry.individualOrGroup === opt}
                      onChange={() => update(i, { ...entry, individualOrGroup: opt })}
                    />
                    <span className="capitalize">{opt}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <TextArea
            label="Description"
            value={entry.description}
            onChange={(v) => update(i, { ...entry, description: v })}
          />
          <StringListEditor
            label="Tech stack"
            values={entry.techStack}
            placeholder="TypeScript"
            addLabel="Add technology"
            onChange={(techStack) => update(i, { ...entry, techStack })}
          />
          <StringListEditor
            label="Narrative fragments"
            values={entry.narrativeFragments}
            placeholder="Reusable sentence about this project"
            addLabel="Add fragment"
            onChange={(narrativeFragments) => update(i, { ...entry, narrativeFragments })}
          />
        </RepeatableCard>
      ))}
      <Button onClick={add}>Add project</Button>
    </Section>
  );
}
