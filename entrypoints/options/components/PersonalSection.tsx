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
    <Section title="Personal information" description="How you're reached and linked.">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Full name" value={value.name} onChange={(v) => set('name', v)} />
        <TextInput
          label="Email"
          type="email"
          value={value.email}
          onChange={(v) => set('email', v)}
        />
        <TextInput label="Phone" value={value.phone} onChange={(v) => set('phone', v)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput
          label="GitHub"
          placeholder="https://github.com/you"
          value={value.links.github ?? ''}
          onChange={(v) => setLink('github', v)}
        />
        <TextInput
          label="LinkedIn"
          placeholder="https://linkedin.com/in/you"
          value={value.links.linkedin ?? ''}
          onChange={(v) => setLink('linkedin', v)}
        />
        <TextInput
          label="Portfolio"
          placeholder="https://you.dev"
          value={value.links.portfolio ?? ''}
          onChange={(v) => setLink('portfolio', v)}
        />
      </div>
    </Section>
  );
}
