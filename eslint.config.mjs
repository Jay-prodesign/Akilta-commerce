import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.staging-build/**',
      'tests/**/*.mjs',
      'tests/runtime/**/*.ts',
      'tests/contract/domain-primitives.spec.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['{apps,packages,connectors,tests}/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.plain-tests.json'],
        tsconfigRootDir: import.meta.dirname,
        onUnsupportedTypeScriptVersion: 'error',
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    },
  },
);
