import { defineContentScript } from '#imports';
import { onMessage } from '../lib/messaging';
import { detectFields, extractPageText } from '../lib/field-detector';
import { buildJobContext } from '../lib/job-context';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Cross-origin iframes on job sites host their own forms; detection must
  // reach into every frame (validated in Phase 6).
  allFrames: true,
  main() {
    // This runs once per frame, so each frame answers a scan for its own
    // document. The panel addresses one frame explicitly (see MAIN_FRAME in the
    // side panel) rather than broadcasting: an unaddressed tabs.sendMessage
    // reaches every frame and keeps whichever reply arrives first, which is not
    // deterministic. Aggregating fields across frames is the platform boundary
    // Phase 16 is written to test and document.
    onMessage('TRIGGER_SCAN', () => ({
      fields: detectFields(document),
      context: buildJobContext(extractPageText(), location.href, document.title),
    }));

    // INSERT_FIELD is handled in Phase 13 (insert-into-page handler).
  },
});
