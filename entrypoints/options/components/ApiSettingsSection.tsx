import type { Settings } from '@/lib/types';
import { MODEL_CHOICES } from '@/lib/storage';
import { Section, TextInput } from './primitives';

const SELECT_CLASSES =
  'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-medium text-slate-900 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

export function ApiSettingsSection({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (v: Settings) => void;
}) {
  const isKnownModel = MODEL_CHOICES.some((choice) => choice.id === value.modelId);
  const hasKey = value.apiKey.trim().length > 0;

  return (
    <Section
      title="Google Gemini AI Engine"
      badge={hasKey ? 'Key Configured ✓' : 'Key Required'}
      description="Bring your own API key. It is stored on this device only, never synced, and used directly to draft answers."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
        </svg>
      }
    >
      <TextInput
        label="Gemini API Key"
        type="password"
        value={value.apiKey}
        onChange={(apiKey) => onChange({ ...value, apiKey })}
        placeholder="AIza…"
        hint={hasKey ? '●●●●●●●● (active)' : 'Starts with AIza…'}
      />

      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Model Selection</span>
          <span className="text-[11px] text-indigo-600 font-medium">Fast & Reliable</span>
        </div>
        <select
          value={value.modelId}
          onChange={(e) => onChange({ ...value, modelId: e.target.value })}
          className={SELECT_CLASSES}
        >
          {!isKnownModel && <option value={value.modelId}>{value.modelId} (custom saved)</option>}
          {MODEL_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-slate-600 flex items-start justify-between gap-3">
        <p className="text-[11px] leading-relaxed">
          Need an API key? Get one for free from Google AI Studio. No credit card required.
        </p>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-600 border border-indigo-200/80 shadow-2xs hover:bg-indigo-50 transition-all"
        >
          Get Key →
        </a>
      </div>
    </Section>
  );
}
