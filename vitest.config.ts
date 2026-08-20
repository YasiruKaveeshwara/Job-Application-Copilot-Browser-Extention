import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WxtVitest wires up '#imports', auto-mocks the extension APIs (fakeBrowser),
  // and applies the project's wxt.config so unit tests can import lib/* freely.
  plugins: [WxtVitest()],
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
  },
});
