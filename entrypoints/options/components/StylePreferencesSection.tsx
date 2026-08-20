import type { ProfileData } from '@/lib/types';
import { Section, TextInput, StringListEditor } from './primitives';

const LENGTHS: ProfileData['stylePreferences']['length'][] = ['concise', 'standard', 'detailed'];

export function StylePreferencesSection({
  value,
  onChange,
}: {
  value: ProfileData['stylePreferences'];
  onChange: (v: ProfileData['stylePreferences']) => void;
}) {
  return (
    <Section title="Style preferences" description="Guides tone and length of generated drafts.">
      <TextInput
        label="Tone"
        placeholder="warm but professional"
        value={value.tone}
        onChange={(v) => onChange({ ...value, tone: v })}
      />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Length</span>
        <select
          value={value.length}
          onChange={(e) =>
            onChange({ ...value, length: e.target.value as ProfileData['stylePreferences']['length'] })
          }
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 sm:w-48"
        >
          {LENGTHS.map((l) => (
            <option key={l} value={l} className="capitalize">
              {l}
            </option>
          ))}
        </select>
      </label>
      <StringListEditor
        label="Things to avoid"
        values={value.avoid}
        placeholder="buzzwords like 'synergy'"
        addLabel="Add avoid item"
        onChange={(avoid) => onChange({ ...value, avoid })}
      />
    </Section>
  );
}
