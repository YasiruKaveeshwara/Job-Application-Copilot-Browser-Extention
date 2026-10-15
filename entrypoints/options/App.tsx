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
      <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-sm shadow-indigo-500/30">
            <svg className="h-6 w-6 animate-spin text-white" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              ></circle>
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-400">Loading profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] font-sans text-slate-900 selection:bg-indigo-500 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/98 shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-sm shadow-indigo-500/25">
              <svg
                className="h-4.5 w-4.5 text-white"
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
              <h1 className="text-[15px] font-bold tracking-tight text-slate-900 leading-none">
                Job Application Copilot
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Profile & AI configuration · Stored locally on this device
              </p>
            </div>
          </div>

          {/* Save controls */}
          <div className="flex items-center gap-3">
            {status === 'saved' && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
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
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                Save failed
              </span>
            )}
            <Button variant="primary" onClick={handleSave}>
              {status === 'saving' ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                  </svg>
                  Saving…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5V15a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V6.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 12.378 1H3.5ZM6 13a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Zm1-4a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H7Z" />
                  </svg>
                  Save Changes
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-4xl space-y-5 px-6 py-8">
        {/* Sections */}
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

        {/* Bottom Save */}
        <div className="flex items-center justify-between py-4 pb-8">
          <p className="text-[11px] text-slate-400">
            All data is stored locally in this browser. Nothing is sent to any server except your
            Gemini API key calls.
          </p>
          <Button variant="primary" onClick={handleSave}>
            {status === 'saving' ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-5 text-center">
        <p className="text-[11px] font-medium text-slate-400">
          Built with <span className="inline-block animate-pulse text-red-400">♥</span> by{' '}
          <a
            href="https://github.com/YasiruKaveeshwara"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-indigo-500 transition-colors hover:text-indigo-700"
          >
            Yasiru Kaveeshwara
          </a>
        </p>
        <p className="mt-0.5 text-[10px] text-slate-300">
          © {new Date().getFullYear()} · All rights reserved
        </p>
      </footer>
    </div>
  );
}
