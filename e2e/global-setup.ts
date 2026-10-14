import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { REPO, TEST_ENV } from './settings';

/**
 * Starts the test worker. It has no HTTP port for Playwright's webServer to wait on, so it
 * is started here and ready once it logs "worker ready". Normal runs use the scripted model
 * (LLM_FAKE); the live run uses the real one from .env.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const live = process.env.AYD_E2E_LIVE === 'true';
  const worker: ChildProcess = spawn(process.execPath, ['dist/main.js'], {
    cwd: resolve(REPO, 'apps/worker'),
    env: { ...process.env, ...TEST_ENV, LLM_FAKE: live ? 'false' : 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ready, failed) => {
    const timer = setTimeout(
      () => failed(new Error('The test worker did not start in 60 s')),
      60_000,
    );
    worker.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('worker ready')) {
        clearTimeout(timer);
        ready();
      }
    });
    worker.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    worker.on('exit', (code) => {
      clearTimeout(timer);
      failed(new Error(`The test worker exited with code ${code}`));
    });
  });
  return async () => {
    worker.kill();
  };
}
