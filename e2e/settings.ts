import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export const REPO = resolve(__dirname, '..');
export const API_PORT = 3100;
export const WEB_PORT = 5174;

// The browser tests run their own API, worker, and web server on other ports and their own
// job queue, so they never meet the developer's running servers or real-model worker. The
// API and worker read the rest of their settings from the root .env.
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  JOB_QUEUE_NAME: 'ayd-e2e',
  SSRF_ALLOW_PRIVATE: 'true',
};

/** live: the opt-in run that asks the real model one question (needs GEMINI_API_KEY). */
export function browserConfig(live: boolean) {
  process.env.AYD_E2E_LIVE = live ? 'true' : 'false';
  return defineConfig({
    testDir: '.',
    testMatch: live ? ['live.spec.ts'] : ['demo.spec.ts', 'a11y.spec.ts'],
    timeout: 90_000,
    expect: { timeout: 30_000 },
    // One at a time: the tests share the sample database's two query slots.
    workers: 1,
    fullyParallel: false,
    reporter: [['list']],
    outputDir: resolve(REPO, 'e2e/test-results'),
    globalSetup: resolve(__dirname, 'global-setup.ts'),
    use: {
      baseURL: `http://localhost:${WEB_PORT}`,
      trace: 'retain-on-failure',
    },
    projects: live
      ? [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }]
      : [
          {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
          { name: 'phone', use: { ...devices['Pixel 7'] } },
        ],
    webServer: [
      {
        command: 'node apps/api/dist/main.js',
        cwd: REPO,
        url: `http://localhost:${API_PORT}/health/ready`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          ...TEST_ENV,
          API_PORT: String(API_PORT),
          APP_WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
          DEV_LOGIN_ENABLED: 'true',
          // Many sign-ins and questions in a few minutes, all from one address.
          AUTH_REQUESTS_PER_MINUTE: '1000',
          SUBMISSIONS_PER_MINUTE: '1000',
        },
      },
      {
        command: `npx vite --port ${WEB_PORT} --strictPort`,
        cwd: resolve(REPO, 'apps/web'),
        url: `http://localhost:${WEB_PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { AYD_API_URL: `http://localhost:${API_PORT}` },
      },
    ],
  });
}
