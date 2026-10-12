// Runs Jest with Node's VM modules enabled. NestJS 12 ships only as ES modules, and Jest can
// require() an ES module only with this flag (Node 24.9 or later). Arguments pass through.
const { spawnSync } = require('node:child_process');

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    '--disable-warning=ExperimentalWarning',
    require.resolve('jest/bin/jest'),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
