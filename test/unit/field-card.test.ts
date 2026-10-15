import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldCard } from '../../entrypoints/sidepanel/state';
import { FieldCardView } from '../../entrypoints/sidepanel/components/FieldCard';

function card(overrides: Partial<FieldCard> = {}): FieldCard {
  return {
    tempId: 'f0',
    label: 'Why do you want to join our company?',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'field-0',
    surroundingText: '',
    classifiedType: 'motivation',
    answerSource: 'generated',
    confidence: 'high',
    draft: 'The first answer.',
    edited: false,
    insert: { phase: 'idle', error: null },
    correction: { value: '', phase: 'idle', error: null },
    ...overrides,
  };
}

describe('FieldCard answer revision', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('opens a separate prompt and applies the revised answer to this card only', async () => {
    const firstCard = card();
    const secondCard = card({
      tempId: 'f1',
      label: 'Describe your experience',
      draft: 'A separate answer.',
    });
    const onRevise = vi.fn(async () => 'A shorter revised answer.');
    const firstDraftChange = vi.fn();
    const secondDraftChange = vi.fn();
    const view = (
      item: FieldCard,
      revise: (instruction: string) => Promise<string>,
      onDraftChange: (draft: string) => void,
    ) =>
      createElement(FieldCardView, {
        card: item,
        domain: 'jobs.example.com',
        pending: false,
        onDraftChange,
        onInsert: vi.fn(),
        onRevise: revise,
        onCorrectionChange: vi.fn(),
        onSaveCorrection: vi.fn(),
      });

    await act(async () => {
      root.render(
        createElement(
          'ul',
          {},
          view(firstCard, onRevise, firstDraftChange),
          view(secondCard, vi.fn(), secondDraftChange),
        ),
      );
    });

    const resendButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Resend',
    );
    expect(resendButtons).toHaveLength(2);

    await act(async () => resendButtons[0]!.click());
    const firstPrompt = container.querySelector<HTMLTextAreaElement>('#revision-instruction-f0');
    const secondPrompt = container.querySelector<HTMLTextAreaElement>('#revision-instruction-f1');
    expect(firstPrompt).not.toBeNull();
    expect(secondPrompt).toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(firstPrompt, 'Make it shorter and more specific.');
      firstPrompt!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Send to AI',
    );
    expect(sendButton).toBeDefined();
    await act(async () => sendButton!.click());

    expect(onRevise).toHaveBeenCalledWith('Make it shorter and more specific.');
    expect(firstDraftChange).toHaveBeenCalledWith('A shorter revised answer.');
    expect(secondDraftChange).not.toHaveBeenCalled();
    expect(container.querySelector('#revision-instruction-f0')).toBeNull();
    expect(container.textContent).toContain('A separate answer.');
  });

  it('does not show resend for static profile answers or static field types', async () => {
    await act(async () => {
      root.render(
        createElement(
          'ul',
          {},
          createElement(FieldCardView, {
            card: card({ answerSource: 'profile' }),
            domain: 'jobs.example.com',
            pending: false,
            onDraftChange: vi.fn(),
            onInsert: vi.fn(),
            onRevise: vi.fn(),
            onCorrectionChange: vi.fn(),
            onSaveCorrection: vi.fn(),
          }),
          createElement(FieldCardView, {
            card: card({ tempId: 'f1', classifiedType: 'phone', label: 'Phone number' }),
            domain: 'jobs.example.com',
            pending: false,
            onDraftChange: vi.fn(),
            onInsert: vi.fn(),
            onRevise: vi.fn(),
            onCorrectionChange: vi.fn(),
            onSaveCorrection: vi.fn(),
          }),
        ),
      );
    });

    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Resend'),
    ).toBe(false);
  });

  it('keeps the revision prompt available and shows an error when the request fails', async () => {
    const onRevise = vi.fn().mockRejectedValue(new Error('Gemini request failed.'));
    await act(async () => {
      root.render(
        createElement(FieldCardView, {
          card: card(),
          domain: 'jobs.example.com',
          pending: false,
          onDraftChange: vi.fn(),
          onInsert: vi.fn(),
          onRevise,
          onCorrectionChange: vi.fn(),
          onSaveCorrection: vi.fn(),
        }),
      );
    });

    const resend = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Resend',
    );
    await act(async () => resend!.click());
    const prompt = container.querySelector<HTMLTextAreaElement>('#revision-instruction-f0');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(prompt, 'Make it shorter.');
      prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Send to AI',
    );
    await act(async () => sendButton!.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Gemini request failed.',
    );
    expect(container.querySelector<HTMLTextAreaElement>('#revision-instruction-f0')?.value).toBe(
      'Make it shorter.',
    );
  });
});
