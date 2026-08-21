import type { ProfileData } from '@/lib/types';
import { Section, TextInput } from './primitives';

export function PersonalSection({
  value,
  onChange,
}: {
  value: ProfileData['personal'];
  onChange: (v: ProfileData['personal']) => void;
}) {
  const set = <K extends keyof ProfileData['personal']>(key: K, v: ProfileData['personal'][K]) =>
    onChange({ ...value, [key]: v });
  const setLink = (key: keyof ProfileData['personal']['links'], v: string) =>
    onChange({ ...value, links: { ...value.links, [key]: v } });

  return (
    <Section
      title="Personal Information"
      description="Primary contact information and professional profiles."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Full name"
          placeholder="e.g. Alex Morgan"
          value={value.name}
          onChange={(v) => set('name', v)}
        />
        <TextInput
          label="Email address"
          type="email"
          placeholder="alex@example.com"
          value={value.email}
          onChange={(v) => set('email', v)}
        />
        <TextInput
          label="Phone number"
          placeholder="+1 (555) 000-0000"
          value={value.phone}
          onChange={(v) => set('phone', v)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 pt-2 border-t border-slate-100">
        <TextInput
          label="GitHub profile"
          placeholder="https://github.com/username"
          value={value.links.github ?? ''}
          onChange={(v) => setLink('github', v)}
        />
        <TextInput
          label="LinkedIn profile"
          placeholder="https://linkedin.com/in/username"
          value={value.links.linkedin ?? ''}
          onChange={(v) => setLink('linkedin', v)}
        />
        <TextInput
          label="Portfolio / Website"
          placeholder="https://yourname.dev"
          value={value.links.portfolio ?? ''}
          onChange={(v) => setLink('portfolio', v)}
        />
      </div>
    </Section>
  );
}
