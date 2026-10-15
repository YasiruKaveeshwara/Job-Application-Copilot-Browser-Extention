import { useEffect, useState } from 'react';
import type { ProfileData, Settings } from '@/lib/types';
import {
  getProfile,
  saveProfile,
  emptyProfile,
  getSettings,
  saveSettings,
  saveAvailableModels,
  defaultSettings,
} from '@/lib/storage';
import { ApiSettingsSection } from '@/entrypoints/options/components/ApiSettingsSection';
import { CachedDraftsSection } from '@/entrypoints/options/components/CachedDraftsSection';
import { CvImportSection } from '@/entrypoints/options/components/CvImportSection';
import { PersonalSection } from '@/entrypoints/options/components/PersonalSection';
import { EducationSection } from '@/entrypoints/options/components/EducationSection';
import { WorkHistorySection } from '@/entrypoints/options/components/WorkHistorySection';
import { ProjectsSection } from '@/entrypoints/options/components/ProjectsSection';
import { SkillsSection } from '@/entrypoints/options/components/SkillsSection';
import { StandardAnswersSection } from '@/entrypoints/options/components/StandardAnswersSection';
import { ResumeVariantsSection } from '@/entrypoints/options/components/ResumeVariantsSection';
import { StylePreferencesSection } from '@/entrypoints/options/components/StylePreferencesSection';
import { PanelButton } from './ui';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type SettingsTab = 'all' | 'api' | 'cv' | 'profile' | 'preferences';

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '◈' },
  { id: 'api', label: 'API Key', icon: '⚡' },
  { id: 'cv', label: 'Import CV', icon: '📄' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'preferences', label: 'Prefs', icon: '⚙️' },
];

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [savedApiKey, setSavedApiKey] = useState('');
  const [autoDiscoverKey, setAutoDiscoverKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [activeTab, setActiveTab] = useState<SettingsTab>('all');

  useEffect(() => {
    let active = true;
    Promise.all([getProfile(), getSettings()])
      .then(([storedProfile, storedSettings]) => {
        if (active) {
          setProfile(storedProfile);
          setSettings(storedSettings);
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
      <div className="flex min-h-screen items-center justify-center bg-[#f8f9fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
            <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
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
          <p className="text-[11px] font-semibold text-slate-400">Loading profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f9fb] text-slate-900 font-sans">
      {/* Sticky Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/98 px-3 pt-3 pb-2 shadow-sm">
        {/* Top row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700"
              aria-label="Back to scan"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <div>
              <h1 className="text-[12px] font-bold tracking-tight text-slate-900 leading-none">
                Settings & Profile
              </h1>
              <p className="text-[9.5px] text-slate-400 mt-0.5">Stored on-device only</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status === 'saved' && (
              <span className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
                Saved
              </span>
            )}
            {status === 'error' && (
              <span className="text-[10.5px] font-semibold text-red-500">Save failed</span>
            )}
            <PanelButton variant="primary" onClick={() => void handleSave()}>
              {status === 'saving' ? (
                <span className="flex items-center gap-1">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
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
                'Save'
              )}
            </PanelButton>
          </div>
        </div>

        {/* Tab filters */}
        <div className="mt-2.5 flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-slate-100 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10.5px] font-semibold tracking-tight transition-all shrink-0 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800'
              }`}
            >
              <span className="text-[10px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Scrollable Form Content */}
      <main className="flex-1 space-y-3 p-3 pb-12">
        {(activeTab === 'all' || activeTab === 'api') && (
          <ApiSettingsSection
            value={settings}
            onChange={patchSettings}
            savedApiKey={savedApiKey}
            autoDiscoverKey={autoDiscoverKey}
          />
        )}
        {(activeTab === 'all' || activeTab === 'cv') && (
          <CvImportSection value={profile} onApply={handleImport} />
        )}
        {(activeTab === 'all' || activeTab === 'profile') && (
          <>
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
          </>
        )}
        {(activeTab === 'all' || activeTab === 'preferences') && (
          <>
            <StylePreferencesSection
              value={profile.stylePreferences}
              onChange={(v) => patch('stylePreferences', v)}
            />
            <CachedDraftsSection />
          </>
        )}

        <div className="flex justify-end pt-2">
          <PanelButton variant="primary" onClick={() => void handleSave()}>
            {status === 'saving' ? 'Saving…' : 'Save Changes'}
          </PanelButton>
        </div>
      </main>
    </div>
  );
}
