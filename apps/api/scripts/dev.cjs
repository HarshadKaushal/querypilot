// Local API dev loop: tsc --watch compiles src to dist, and node --watch restarts the API
// when dist changes. tsx is not used because esbuild does not emit decorator metadata, and
// Nest needs that metadata to inject classes such as TokenService.
const { execFileSync, spawn } = require('node:child_process');
const { resolve } = require('node:path');

const app = resolve(__dirname, '..');
const tsc = require.resolve('typescript/bin/tsc');
const project = ['-p', 'tsconfig.build.json'];

// One full compile first, so node never starts on a stale or missing dist.
execFileSync(process.execPath, [tsc, ...project], { cwd: app, stdio: 'inherit' });

const children = [
  spawn(process.execPath, [tsc, ...project, '--watch', '--preserveWatchOutput'], {
    cwd: app,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--watch', 'dist/main.js'], { cwd: app, stdio: 'inherit' }),
];

function stop(code) {
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

for (const child of children) {
  child.on('exit', (code) => stop(code ?? 0));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
