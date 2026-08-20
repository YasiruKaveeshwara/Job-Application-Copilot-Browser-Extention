import { defineContentScript } from '#imports';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Cross-origin iframes on job sites host their own forms; detection must
  // reach into every frame (validated in Phase 6).
  allFrames: true,
  main() {
    // Field detection + insert handling are wired up in Phase 6 / Phase 13.
  },
});
