import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'test-fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{mjs,cjs,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Phase 8 acceptance criterion, enforced mechanically: message passing goes
  // through the typed helpers in lib/messaging.ts, nowhere else.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['lib/messaging.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='sendMessage'][object.property.name='runtime']",
          message:
            'Use sendMessage from lib/messaging.ts instead of raw browser.runtime.sendMessage.',
        },
        {
          selector:
            "MemberExpression[property.name='onMessage'][object.property.name='runtime']",
          message:
            'Use onMessage from lib/messaging.ts instead of raw browser.runtime.onMessage.',
        },
      ],
    },
  },
  // Disable formatting rules that conflict with Prettier. Keep last.
  prettier,
);
