import { defineBackground } from '#imports';
import { onMessage } from '../lib/messaging';
import { generateAnswers } from '../lib/orchestrator';

export default defineBackground(() => {
  // Thin by design: the entrypoint wires messages to handlers, the handlers live
  // in lib/ where they can be tested without a service worker.
  //
  // `onMessage` awaits the handler and sends a rejection back to the sender as a
  // rejected promise, so a throw here becomes a caught error in the panel rather
  // than an unhandled rejection in the worker.
  onMessage('REQUEST_GENERATION', ({ data }) => generateAnswers(data));

  // SAVE_FIELD_MAPPING is handled in Phase 14 (learned mapping cache).
});
