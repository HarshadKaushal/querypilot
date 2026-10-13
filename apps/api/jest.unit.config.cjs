/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['\\.int-spec\\.ts$', '\\.e2e-spec\\.ts$'],
  // Test helpers from @ayd/core are not built; load them from source.
  moduleNameMapper: {
    '^@ayd/core/testing$': '<rootDir>/../../packages/core/src/testing/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
