import type { ProfileData } from '@/lib/types';
import { Section, StringListEditor } from './primitives';

export function SkillsSection({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: ProfileData['skills']) => void;
}) {
  return (
    <Section
      title="Skills & Core Proficiencies"
      badge={`${value.length} skills`}
      description="Languages, frameworks, developer tools, and domain expertise."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      }
    >
      <StringListEditor
        label="List of skills & tools"
        values={value}
        placeholder="e.g. React, TypeScript, GraphQL, Docker, Kubernetes"
        addLabel="Add skill"
        onChange={onChange}
      />
    </Section>
  );
}
