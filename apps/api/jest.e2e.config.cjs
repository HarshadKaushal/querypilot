/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['<rootDir>/test/helpers/env.ts'],
  // Test helpers from @ayd/core are not built; load them from source.
  moduleNameMapper: {
    '^@ayd/core/testing$': '<rootDir>/../../packages/core/src/testing/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
