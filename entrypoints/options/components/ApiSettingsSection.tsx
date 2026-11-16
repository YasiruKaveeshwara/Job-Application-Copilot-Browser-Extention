import { useEffect, useState } from 'react';
import type { Settings, ModelChoice } from '@/lib/types';
import { getAvailableModels, saveAvailableModels, saveSettings } from '@/lib/storage';
import { sendMessage } from '@/lib/messaging';
import { Section, TextInput } from './primitives';
import { LoadingIndicator } from '../../components/LoadingIndicator';

const SELECT_CLASSES =
  'w-full rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] px-3.5 py-2.5 text-[12px] font-medium text-slate-900 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 hover:border-blue-200 cursor-pointer';

export function ApiSettingsSection({
  value,
  onChange,
  savedApiKey,
  autoDiscoverKey,
}: {
  value: Settings;
  onChange: (v: Settings) => void;
  savedApiKey: string;
  autoDiscoverKey: string;
}) {
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const hasKey = value.apiKey.trim().length > 0;
  const keyIsSaved = value.apiKey.trim() === savedApiKey;

  // Load models previously discovered for the saved API key.
  useEffect(() => {
    let active = true;
    getAvailableModels()
      .then((stored) => {
        if (active) {
          setModels(stored);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRefreshError(error instanceof Error ? error.message : 'Could not load saved models');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshModels = async (apiKey: string, chooseRecommended: boolean) => {
    setIsRefreshing(true);
    setRefreshMessage(null);
    setRefreshError(null);
    if (chooseRecommended) setModels([]);

    try {
      if (chooseRecommended) await saveAvailableModels([]);
      const fetched = await sendMessage('FETCH_AVAILABLE_MODELS', {
        apiKey,
      });
      if (fetched && fetched.length > 0) {
        setModels(fetched);
        setRefreshMessage(`✓ Found ${fetched.length} available models`);
        if (chooseRecommended || !value.modelId.trim()) {
          const nextSettings = { ...value, apiKey, modelId: fetched[0]!.id };
          onChange(nextSettings);
          await saveSettings(nextSettings);
        }
      } else {
        setRefreshError('No generation models returned for this key');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Could not fetch models';
      setRefreshError(msg);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Saving a different API key always discovers that key's models and selects
  // the highest-ranked result returned by the API.
  useEffect(() => {
    if (!autoDiscoverKey || autoDiscoverKey !== savedApiKey) return;
    void refreshModels(autoDiscoverKey, true);
    // Run only when the parent confirms a new key has been saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDiscoverKey, savedApiKey]);

  const handleRefreshModels = async () => {
    if (!hasKey) {
      setRefreshError('Please enter an API key first');
      setRefreshMessage(null);
      return;
    }
    if (!keyIsSaved) {
      setRefreshError('Save the new API key before refreshing its models');
      setRefreshMessage(null);
      return;
    }
    await refreshModels(value.apiKey.trim(), false);
  };

  const handleModelChange = async (modelId: string) => {
    const nextSettings = { ...value, modelId };
    onChange(nextSettings);
    if (!keyIsSaved || !savedApiKey) return;

    setRefreshError(null);
    try {
      await saveSettings({ ...nextSettings, apiKey: savedApiKey });
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Could not save model selection');
    }
  };

  const isKnownModel = models.some((choice) => choice.id === value.modelId);

  return (
    <Section
      title="Google Gemini AI Engine"
      badge={hasKey ? 'Key Configured ✓' : 'Key Required'}
      description="Bring your own API key. It is stored on this device only, never synced, and used directly to draft answers."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
        </svg>
      }
    >
      <TextInput
        label="Gemini API Key"
        type="password"
        value={value.apiKey}
        onChange={(apiKey) => {
          onChange({ ...value, apiKey });
          setRefreshMessage(null);
          setRefreshError(null);
        }}
        placeholder="AIza…"
        hint={hasKey ? '●●●●●●●● (active)' : 'Starts with AIza…'}
      />

      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Model Selection</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshModels}
              disabled={isRefreshing || !hasKey || !keyIsSaved}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Query Gemini API for models available on your account"
            >
              {isRefreshing && <LoadingIndicator size="sm" />}
              <span>{isRefreshing ? 'Checking...' : 'Refresh Models'}</span>
            </button>
          </div>
        </div>

        {refreshMessage && (
          <div className="mb-1.5 text-[11px] text-emerald-600 font-medium">{refreshMessage}</div>
        )}
        {refreshError && (
          <div className="mb-1.5 text-[11px] text-rose-600 font-medium">{refreshError}</div>
        )}

        <select
          value={value.modelId}
          onChange={(e) => void handleModelChange(e.target.value)}
          disabled={!hasKey || !keyIsSaved || isRefreshing}
          className={SELECT_CLASSES}
        >
          {!isKnownModel && (
            <option value={value.modelId}>
              {value.modelId ? `${value.modelId} (current selection)` : 'Select a model...'}
            </option>
          )}
          {models.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          A new API key automatically loads its available models and selects the top-ranked option.
          Your later selection is saved automatically.
        </p>
      </label>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Need an API key? Get one for free from Google AI Studio — no credit card required.
        </p>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300 transition-all shadow-xs"
        >
          Get Key
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.22 14.78a.75.75 0 0 0 1.06 0l7.22-7.22v5.69a.75.75 0 0 0 1.5 0v-7.5a.75.75 0 0 0-.75-.75h-7.5a.75.75 0 0 0 0 1.5h5.69l-7.22 7.22a.75.75 0 0 0 0 1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      </div>
    </Section>
  );
}
