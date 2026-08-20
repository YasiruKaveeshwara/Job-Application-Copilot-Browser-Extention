import { useEffect, useState } from 'react';
import type { ProfileData } from '@/lib/types';
import { getProfile, saveProfile, emptyProfile } from '@/lib/storage';
import { Button } from './components/primitives';
import { PersonalSection } from './components/PersonalSection';
import { EducationSection } from './components/EducationSection';
import { WorkHistorySection } from './components/WorkHistorySection';
import { ProjectsSection } from './components/ProjectsSection';
import { StandardAnswersSection } from './components/StandardAnswersSection';
import { ResumeVariantsSection } from './components/ResumeVariantsSection';
import { StylePreferencesSection } from './components/StylePreferencesSection';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Load existing profile on mount.
  useEffect(() => {
    let active = true;
    getProfile()
      .then((p) => {
        if (active) {
          setProfile(p);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Any edit clears a previously-shown "saved" badge.
  const patch = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
  };

  const handleSave = async () => {
    setStatus('saving');
    try {
      await saveProfile(profile);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading profile…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Job Application Copilot</h1>
            <p className="text-sm text-gray-500">Your profile. Stored locally on this device only.</p>
          </div>
          <div className="flex items-center gap-3">
            {status === 'saved' && <span className="text-sm text-green-600">Saved ✓</span>}
            {status === 'error' && <span className="text-sm text-red-600">Save failed</span>}
            <Button variant="primary" onClick={handleSave}>
              {status === 'saving' ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <PersonalSection value={profile.personal} onChange={(v) => patch('personal', v)} />
        <EducationSection value={profile.education} onChange={(v) => patch('education', v)} />
        <WorkHistorySection value={profile.workHistory} onChange={(v) => patch('workHistory', v)} />
        <ProjectsSection value={profile.projects} onChange={(v) => patch('projects', v)} />
        <StandardAnswersSection
          value={profile.standardAnswers}
          onChange={(v) => patch('standardAnswers', v)}
        />
        <ResumeVariantsSection
          value={profile.resumeVariants}
          onChange={(v) => patch('resumeVariants', v)}
        />
        <StylePreferencesSection
          value={profile.stylePreferences}
          onChange={(v) => patch('stylePreferences', v)}
        />

        <div className="flex justify-end pb-12">
          <Button variant="primary" onClick={handleSave}>
            {status === 'saving' ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </main>
    </div>
  );
}
