import { useEffect, useState } from 'react';
import type { ProfileData, Settings } from '@/lib/types';
import {
  getProfile,
  saveProfile,
  emptyProfile,
  getSettings,
  saveSettings,
  saveAvailableModels,
  getPromptSettings,
  savePromptSettings,
  defaultSettings,
} from '@/lib/storage';
import type { PromptSettings } from '@/lib/prompt-settings';
import { DEFAULT_PROMPT_SETTINGS } from '@/lib/prompt-settings';
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
import { PromptSettingsSection } from './components/PromptSettingsSection';
import { LoadingIndicator } from '../components/LoadingIndicator';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [prompts, setPrompts] = useState<PromptSettings>({ ...DEFAULT_PROMPT_SETTINGS });
  const [promptPageOpen, setPromptPageOpen] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState('');
  const [autoDiscoverKey, setAutoDiscoverKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Load existing profile and settings on mount.
  useEffect(() => {
    let active = true;
    Promise.all([getProfile(), getSettings(), getPromptSettings()])
      .then(([storedProfile, storedSettings, storedPrompts]) => {
        if (active) {
          setProfile(storedProfile);
          setSettings(storedSettings);
          setPrompts(storedPrompts);
          setSavedApiKey(storedSettings.apiKey.trim());
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

  const patchPrompts = (value: PromptSettings) => {
    setPrompts(value);
    setStatus('idle');
  };

  const handleSave = async () => {
    setStatus('saving');
    const apiKey = settings.apiKey.trim();
    const keyChanged = apiKey !== savedApiKey;
    const settingsToSave = {
      ...settings,
      apiKey,
      modelId: keyChanged ? '' : settings.modelId,
    };
    try {
      await Promise.all([
        saveProfile(profile),
        saveSettings(settingsToSave),
        savePromptSettings(prompts),
        ...(keyChanged ? [saveAvailableModels([])] : []),
      ]);
      setSettings(settingsToSave);
      setSavedApiKey(apiKey);
      if (keyChanged && apiKey) setAutoDiscoverKey(apiKey);
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
      <div className="flex min-h-screen items-center justify-center bg-[#f4f8fc] px-6">
        <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-[24px] border border-blue-100 bg-white px-8 py-10 text-blue-600 shadow-[0_12px_34px_rgba(27,111,190,0.1)]">
          <LoadingIndicator size="lg" />
          <p className="text-sm font-semibold text-slate-500">Preparing your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f8fc] font-sans text-slate-900 selection:bg-blue-500 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-[#dbe7f3] bg-white/90 shadow-[0_8px_24px_rgba(27,78,125,0.06)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-8 py-5">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#0b6fe4] shadow-sm shadow-blue-500/30">
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
            <Button variant="secondary" onClick={() => setPromptPageOpen((open) => !open)}>
              {promptPageOpen ? 'Back to settings' : 'Edit prompts'}
            </Button>
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
                  <LoadingIndicator size="sm" />
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
      <main className="mx-auto max-w-5xl space-y-6 px-8 py-10">
        {promptPageOpen ? (
          <PromptSettingsSection value={prompts} onChange={patchPrompts} />
        ) : (
          <>
            <ApiSettingsSection
              value={settings}
              onChange={patchSettings}
              savedApiKey={savedApiKey}
              autoDiscoverKey={autoDiscoverKey}
            />
            <CvImportSection value={profile} onApply={handleImport} />
            <PersonalSection value={profile.personal} onChange={(v) => patch('personal', v)} />
            <EducationSection value={profile.education} onChange={(v) => patch('education', v)} />
            <WorkHistorySection
              value={profile.workHistory}
              onChange={(v) => patch('workHistory', v)}
            />
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
          </>
        )}

        {/* Bottom Save */}
        <div className="flex items-center justify-between border-t border-blue-100 pt-6 pb-2">
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
      <footer className="border-t border-[#dbe7f3] bg-white py-5 text-center">
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
