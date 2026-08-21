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

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
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
      <div className="flex min-h-screen items-center justify-center text-xs font-semibold text-slate-400">
        <svg className="h-5 w-5 animate-spin text-indigo-600 mr-2" viewBox="0 0 24 24" fill="none">
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

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'api', label: '⚡ API' },
    { id: 'cv', label: '📄 CV' },
    { id: 'profile', label: '👤 Profile' },
    { id: 'preferences', label: '⚙️ Prefs' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/80 text-slate-900 font-sans">
      {/* Sticky Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 p-3 shadow-2xs backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
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
              <h1 className="text-xs font-bold tracking-tight text-slate-900">
                Settings & Profile
              </h1>
              <p className="text-[10px] text-slate-500">Stored on-device only</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'saved' && (
              <span className="text-[11px] font-semibold text-emerald-600">Saved ✓</span>
            )}
            {status === 'error' && (
              <span className="text-[11px] font-semibold text-red-600">Save failed</span>
            )}
            <PanelButton variant="primary" onClick={() => void handleSave()}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </PanelButton>
          </div>
        </div>

        {/* Tab category filters */}
        <div className="mt-2.5 flex items-center gap-1 overflow-x-auto border-t border-slate-100 pt-2 pb-0.5 no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold tracking-tight transition-all shrink-0 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Scrollable Form Content */}
      <main className="flex-1 space-y-4 p-3 pb-12">
        {(activeTab === 'all' || activeTab === 'api') && (
          <ApiSettingsSection value={settings} onChange={patchSettings} />
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
