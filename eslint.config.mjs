// ESLint 10 flat config.
// NOTE: `next lint` was removed in Next.js 16 and the `eslint-config-next`
// distribution at 16.2.3 bundles an `eslint-plugin-react` version whose rule
// context API is incompatible with ESLint 10. Until that is resolved upstream,
// we run a focused flat config on just the Phase 1 backend code (no React).

import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
      'components/**',
      'hooks/**',
      'app/**',
      'lib/claude-*.ts',
      'postcss.config.mjs',
      'tailwind.config.ts',
      'next.config.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      'lib/db.ts',
      'lib/local-day.ts',
      'lib/sync-sessions.ts',
      'instrumentation.ts',
      'tests/**/*.ts',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        globalThis: 'readonly',
        NodeJS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Intl: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
