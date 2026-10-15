import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../../lib/storage';
import { MOCK_EXTRACTED_CV } from '../../lib/extractor/mock-extractor';
import { CvImportSection } from '../../entrypoints/options/components/CvImportSection';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/messaging', () => ({
  sendMessage: mocks.sendMessage,
}));

describe('CV import auto-save', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue(MOCK_EXTRACTED_CV);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('saves extracted profile fields after upload without waiting for confirmation', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(createElement(CvImportSection, { value: emptyProfile(), onApply }));
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });

    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input!.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    });

    const savedProfile = onApply.mock.calls[0]![0];
    expect(savedProfile.personal.name).toBe(MOCK_EXTRACTED_CV.personal!.name);
    expect(savedProfile.education).toHaveLength(MOCK_EXTRACTED_CV.education!.length);
    expect(savedProfile.workHistory).toHaveLength(MOCK_EXTRACTED_CV.workHistory!.length);
    expect(savedProfile.skills).toEqual(MOCK_EXTRACTED_CV.skills);
    expect(savedProfile.projects).toEqual([]);
    expect(container.textContent).toContain('Was this solo or a team project?');
  });

  it('keeps extracted data available to retry when automatic persistence fails', async () => {
    const onApply = vi.fn().mockRejectedValue(new Error('Storage write failed'));
    await act(async () => {
      root.render(createElement(CvImportSection, { value: emptyProfile(), onApply }));
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });

    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input!.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    });

    expect(container.textContent).toContain('Automatic save failed:');
    expect(container.textContent).toContain('Storage write failed');
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input')].some(
        (field) => field.value === 'Mock Candidate',
      ),
    ).toBe(true);
    expect(container.textContent).toContain('Save 16 remaining items');
  });

  it('stops loading and shows a retry hint when extraction times out', async () => {
    const timeoutMessage =
      'Gemini took too long to respond. Try again or select another model in the extension options.';
    mocks.sendMessage.mockRejectedValue(new Error(timeoutMessage));
    await act(async () => {
      root.render(createElement(CvImportSection, { value: emptyProfile(), onApply: vi.fn() }));
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'resume.pdf', { type: 'application/pdf' });

    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input!.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    });

    await vi.waitFor(() => expect(container.textContent).toContain(timeoutMessage));
    expect(container.textContent).not.toContain('Reading your CV with Gemini');
    expect(input!.disabled).toBe(false);
  });
});
