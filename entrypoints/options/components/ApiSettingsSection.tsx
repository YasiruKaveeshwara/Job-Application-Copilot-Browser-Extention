import type { Settings } from '@/lib/types';
import { MODEL_CHOICES } from '@/lib/storage';
import { Section, TextInput } from './primitives';

const SELECT_CLASSES =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500';

export function ApiSettingsSection({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (v: Settings) => void;
}) {
  // A model ID saved by an older build (or typed by hand) must still show up as
  // the selected option rather than silently reverting to the first choice.
  const isKnownModel = MODEL_CHOICES.some((choice) => choice.id === value.modelId);

  return (
    <Section
      title="Gemini API"
      description="Bring your own key. It is stored in this browser profile only, never synced and never sent anywhere except Google's API. Never commit it to a repository."
    >
      <TextInput
        label="API key"
        type="password"
        value={value.apiKey}
        onChange={(apiKey) => onChange({ ...value, apiKey })}
        placeholder="AIza…"
      />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Model</span>
        <select
          value={value.modelId}
          onChange={(e) => onChange({ ...value, modelId: e.target.value })}
          className={SELECT_CLASSES}
        >
          {!isKnownModel && <option value={value.modelId}>{value.modelId} (saved)</option>}
          {MODEL_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-gray-500">
        Create a key at{' '}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Google AI Studio
        </a>
        . Without a key the extension still detects fields, but cannot draft answers.
      </p>
    </Section>
  );
}
