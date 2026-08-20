import { defineContentScript } from '#imports';
import { onMessage } from '../lib/messaging';
import { detectFields, extractPageText } from '../lib/field-detector';
import { buildJobContext } from '../lib/job-context';
import { insertIntoField } from '../lib/insert-handler';

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

    // INSERT_FIELD writes one reviewed draft into one field. It is the only
    // thing this extension ever writes to a page, and never on its own
    // initiative — the user presses Insert on a card they have read.
    onMessage('INSERT_FIELD', ({ data }) => insertIntoField(document, data));
  },
});
