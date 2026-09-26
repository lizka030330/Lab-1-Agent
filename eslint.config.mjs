import next from 'eslint-config-next';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    // Артефакти збірки й звітів не лінтимо.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      '.agent-log/**',
      'next-env.d.ts',
    ],
  },
  ...next,
];

export default config;
