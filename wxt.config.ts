import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Use explicit imports from '#imports' everywhere instead of magic globals.
  imports: false,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Job Application Copilot',
    description:
      'AI copilot that detects application form fields and drafts answers from your profile. No auto-submit.',
    permissions: ['storage', 'scripting', 'activeTab'],
    action: {
      default_title: 'Open Job Application Copilot',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    // Broad host access is required so field detection works on arbitrary job
    // sites and their cross-origin iframes. Narrowing this breaks the
    // universal-detection requirement (see build guide, Phase 1).
    host_permissions: ['<all_urls>'],
  },
});
