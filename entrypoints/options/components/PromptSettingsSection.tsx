import type { PromptSettings } from '@/lib/prompt-settings';
import { DEFAULT_PROMPT_SETTINGS, PROMPT_FIELDS } from '@/lib/prompt-settings';
import { Button, Section } from './primitives';

export function PromptSettingsSection({
  value,
  onChange,
}: {
  value: PromptSettings;
  onChange: (next: PromptSettings) => void;
}) {
  const sections = [...new Set(PROMPT_FIELDS.map((field) => field.section))];

  return (
    <Section
      title="AI Prompts"
      description="Customize the instructions used for answer drafting, saved-answer matching, field filtering, and CV import. Click Save Changes to store your edits locally."
      badge="Editable"
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
        </svg>
      }
    >
      <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
        <p className="text-[11px] leading-relaxed text-amber-900">
          Prompts affect model behavior and output quality. Keep required response formats and
          safety instructions intact if you edit them. Use {'{count}'} and {'{plural}'} in the
          answer-drafting reminder; these are replaced with the current field count and plural
          suffix.
        </p>
        <Button
          variant="secondary"
          className="shrink-0 px-2.5 py-1.5 text-[10px]"
          onClick={() => onChange({ ...DEFAULT_PROMPT_SETTINGS })}
        >
          Reset defaults
        </Button>
      </div>

      {sections.map((section) => (
        <div key={section} className="space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{section}</h3>
          {PROMPT_FIELDS.filter((field) => field.section === section).map((field) => (
            <label key={field.id} className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">{field.label}</span>
              <span className="mb-2 block text-[11px] leading-relaxed text-slate-500">
                {field.description}
              </span>
              <textarea
                rows={Math.min(18, Math.max(4, value[field.id].split('\n').length + 1))}
                value={value[field.id]}
                onChange={(event) => onChange({ ...value, [field.id]: event.target.value })}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-slate-900 transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/15 hover:border-slate-300"
                spellCheck={false}
              />
            </label>
          ))}
        </div>
      ))}
    </Section>
  );
}
