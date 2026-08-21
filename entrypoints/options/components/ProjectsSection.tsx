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
      title="Key Projects & Portfolios"
      badge={`${value.length} projects`}
      description="Individual vs. group classification shapes how answers are phrased ('I built' vs 'We collaborated on')."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      }
    >
      <div className="space-y-3">
        {value.map((entry, i) => (
          <RepeatableCard
            key={i}
            label={entry.name ? `${entry.name} (${entry.individualOrGroup})` : `Project #${i + 1}`}
            onRemove={() => remove(i)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Project name"
                placeholder="e.g. Distributed Cache Engine"
                value={entry.name}
                onChange={(v) => update(i, { ...entry, name: v })}
              />
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Project Type
                </span>
                <div className="flex gap-4 pt-1">
                  {(['individual', 'group'] as const).map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name={`project-${i}-type`}
                        checked={entry.individualOrGroup === opt}
                        onChange={() => update(i, { ...entry, individualOrGroup: opt })}
                        className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="capitalize">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <TextArea
              label="Overview & description"
              placeholder="High level summary of the problem, architecture, and results..."
              value={entry.description}
              onChange={(v) => update(i, { ...entry, description: v })}
            />
            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-slate-200/50">
              <StringListEditor
                label="Technologies used"
                values={entry.techStack}
                placeholder="e.g. Go, Redis, Docker"
                addLabel="Add technology"
                onChange={(techStack) => update(i, { ...entry, techStack })}
              />
              <StringListEditor
                label="Key narrative highlights"
                values={entry.narrativeFragments}
                placeholder="Reusable quote/story about this project..."
                addLabel="Add narrative fragment"
                onChange={(narrativeFragments) => update(i, { ...entry, narrativeFragments })}
              />
            </div>
          </RepeatableCard>
        ))}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          + Add project
        </Button>
      </div>
    </Section>
  );
}
