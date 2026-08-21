import type { ProfileData } from '@/lib/types';
import { Section, StringListEditor } from './primitives';

// Skills as plain names. They exist as their own section because a CV lists them
// that way and the import has to have somewhere to put them; drafts read them
// through the same retrieval as everything else in the profile.

export function SkillsSection({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: ProfileData['skills']) => void;
}) {
  return (
    <Section
      title="Skills"
      description="Tools, languages, and practices you would claim in an application."
    >
      <StringListEditor
        label="Skills"
        values={value}
        placeholder="TypeScript"
        addLabel="Add skill"
        onChange={onChange}
      />
    </Section>
  );
}
