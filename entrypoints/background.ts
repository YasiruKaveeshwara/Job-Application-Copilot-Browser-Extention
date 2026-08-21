import { browser, defineBackground } from '#imports';
import { onMessage } from '../lib/messaging';
import { generateAnswers, describeGenerationFailure } from '../lib/orchestrator';
import { saveFieldMapping } from '../lib/mapping-cache';
import { getExtractor } from '../lib/extractor';

/**
 * Make the toolbar button open the review panel.
 *
 * Chrome does not open a side panel on its own, and this API exists only there.
 * Failing to bind it is cosmetic — the panel is still reachable from the
 * extension menu — so it must never take message handling down with it, whether
 * the API is missing (throws) or the call is rejected.
 */
function bindSidePanelToToolbarIcon(): void {
  const report = (error: unknown) => {
    console.warn('[job-copilot] could not bind the side panel to the toolbar icon', error);
  };
  try {
    void browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(report);
  } catch (error) {
    report(error);
  }
}

export default defineBackground(() => {
  // Thin by design: the entrypoint wires messages to handlers, the handlers live
  // in lib/ where they can be tested without a service worker.
  //
  // `onMessage` awaits the handler and sends a rejection back to the sender as a
  // rejected promise, so a throw here becomes a caught error in the panel rather
  // than an unhandled rejection in the worker.
  onMessage('REQUEST_GENERATION', ({ data }) => generateAnswers(data));

  // A correction the user typed on a card. Handled here rather than in the panel
  // so the panel never touches storage directly, and so a save that fails comes
  // back as a rejection the card can show.
  onMessage('SAVE_FIELD_MAPPING', ({ data }) => saveFieldMapping(data));

  // A CV the user uploaded on the options page. Wired straight to the extractor
  // because there is nothing to orchestrate — one request, one answer — and it
  // runs here rather than in the page so the API key and the provider endpoint
  // stay in this bundle. Nothing is saved: the reply is data for the review
  // screen, which writes only what the user then ticks.
  //
  // Failures go through the same wording as a generation failure, so a wrong key
  // or an unreachable API reads the same on the options page as it does in the
  // panel — and no provider payload crosses the message boundary.
  onMessage('EXTRACT_CV', async ({ data }) => {
    try {
      return await getExtractor().extract(data.pdfBase64);
    } catch (error) {
      throw new Error(describeGenerationFailure(error), { cause: error });
    }
  });

  bindSidePanelToToolbarIcon();
});
