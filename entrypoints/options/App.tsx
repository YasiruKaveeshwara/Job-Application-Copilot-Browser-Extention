import { useEffect, useState } from 'react';
import type { ProfileData, Settings } from '@/lib/types';
import {
  getProfile,
  saveProfile,
  emptyProfile,
  getSettings,
  saveSettings,
  defaultSettings,
} from '@/lib/storage';
import { Button } from './components/primitives';
import { ApiSettingsSection } from './components/ApiSettingsSection';
import { CachedDraftsSection } from './components/CachedDraftsSection';
import { CvImportSection } from './components/CvImportSection';
import { PersonalSection } from './components/PersonalSection';
import { EducationSection } from './components/EducationSection';
import { WorkHistorySection } from './components/WorkHistorySection';
import { ProjectsSection } from './components/ProjectsSection';
import { SkillsSection } from './components/SkillsSection';
import { StandardAnswersSection } from './components/StandardAnswersSection';
import { ResumeVariantsSection } from './components/ResumeVariantsSection';
import { StylePreferencesSection } from './components/StylePreferencesSection';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Load existing profile and settings on mount.
  useEffect(() => {
    let active = true;
    Promise.all([getProfile(), getSettings()])
      .then(([storedProfile, storedSettings]) => {
        if (active) {
          setProfile(storedProfile);
          setSettings(storedSettings);
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

  const patch = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
  };

  const patchSettings = (value: Settings) => {
    setSettings(value);
    setStatus('idle');
  };

  const handleSave = async () => {
    setStatus('saving');
    try {
      await Promise.all([saveProfile(profile), saveSettings(settings)]);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const handleImport = async (next: ProfileData) => {
    setProfile(next);
    setStatus('saving');
    try {
      await saveProfile(next);
      setStatus('saved');
    } catch (error) {
      setStatus('error');
      throw error;
    }
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs font-semibold text-slate-400">
        <svg className="h-6 w-6 animate-spin text-indigo-600 mr-2" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        Loading profile…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/80 font-sans text-slate-900 selection:bg-indigo-500 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 shadow-sm shadow-indigo-500/25">
              <svg
                className="h-5 w-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-slate-900">
                Job Application Copilot
              </h1>
              <p className="text-xs text-slate-500">
                Profile and AI configuration • Stored locally on this device
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status === 'saved' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
                Saved successfully
              </span>
            )}
            {status === 'error' && (
              <span className="text-xs font-semibold text-red-600">Save failed</span>
            )}
            <Button variant="primary" onClick={handleSave}>
              {status === 'saving' ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <ApiSettingsSection value={settings} onChange={patchSettings} />
        <CvImportSection value={profile} onApply={handleImport} />
        <PersonalSection value={profile.personal} onChange={(v) => patch('personal', v)} />
        <EducationSection value={profile.education} onChange={(v) => patch('education', v)} />
        <WorkHistorySection value={profile.workHistory} onChange={(v) => patch('workHistory', v)} />
        <ProjectsSection value={profile.projects} onChange={(v) => patch('projects', v)} />
        <SkillsSection value={profile.skills} onChange={(v) => patch('skills', v)} />
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
        <CachedDraftsSection />

        <div className="flex justify-end pt-4 pb-16">
          <Button variant="primary" onClick={handleSave}>
            {status === 'saving' ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </main>
    </div>
  );
}
