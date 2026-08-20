import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.FIXTURE_PORT ?? 3999);

export default defineConfig({
  testDir: 'test/e2e',
  // Extension E2E specs launch their own persistent context and cannot share
  // one; keep the runner serial.
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  // Chromium only. MV3 extension specs load the unpacked build via
  // chromium.launchPersistentContext() inside the specs themselves (see the
  // build guide, section 1); the project below covers the non-extension smoke
  // checks that just need the fixture server.
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'node test/e2e/static-server.mjs',
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
