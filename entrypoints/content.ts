import { runCapture } from '../lib/capture/engine';

export default defineContentScript({
  // Capture runs everywhere — your pool is the whole web, not one site.
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false, // top frame only; skip ad/embed iframes
  main() {
    void runCapture();
  },
});
