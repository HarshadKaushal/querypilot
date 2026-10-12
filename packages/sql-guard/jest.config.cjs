/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/__fixtures__/**'],
  // The guard is safety code: the blueprint asks for near-complete coverage of its rules.
  coverageThreshold: {
    global: { statements: 99, branches: 95, functions: 100, lines: 99 },
  },
};
