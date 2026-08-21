import type { ProfileData } from '@/lib/types';
import { Section, TextInput, StringListEditor } from './primitives';

const LENGTHS: ProfileData['stylePreferences']['length'][] = ['concise', 'standard', 'detailed'];

const SELECT_CLASSES =
  'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-medium text-slate-900 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-48';

export function StylePreferencesSection({
  value,
  onChange,
}: {
  value: ProfileData['stylePreferences'];
  onChange: (v: ProfileData['stylePreferences']) => void;
}) {
  return (
    <Section
      title="Tone & Writing Style Preferences"
      description="Customize the voice, phrasing, answer length, and words to avoid when AI drafts responses."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Desired tone of voice"
          placeholder="e.g. warm, direct, highly technical, and confident"
          value={value.tone}
          onChange={(v) => onChange({ ...value, tone: v })}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-700">
            Answer length preference
          </span>
          <select
            value={value.length}
            onChange={(e) =>
              onChange({
                ...value,
                length: e.target.value as ProfileData['stylePreferences']['length'],
              })
            }
            className={SELECT_CLASSES}
          >
            {LENGTHS.map((l) => (
              <option key={l} value={l} className="capitalize">
                {l} (
                {l === 'concise'
                  ? '1-2 punchy sentences'
                  : l === 'standard'
                    ? '1 rich paragraph'
                    : 'comprehensive story'}
                )
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pt-2 border-t border-slate-100">
        <StringListEditor
          label="Cliches & phrases to avoid"
          values={value.avoid}
          placeholder="e.g. 'go-getter', 'synergistic', 'hard-working'"
          addLabel="Add phrase to avoid"
          onChange={(avoid) => onChange({ ...value, avoid })}
        />
      </div>
    </Section>
  );
}
