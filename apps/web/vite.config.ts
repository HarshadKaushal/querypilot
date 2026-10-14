import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser talks only to this dev server; /v1 is passed on to the API. The page and
    // the API then share one origin, so the httpOnly refresh cookie works without CORS
    // (ADR 0014). Production puts both behind one domain the same way (Phase 12).
    proxy: {
      // AYD_API_URL lets the browser tests point a second dev server at their own API.
      '/v1': { target: process.env.AYD_API_URL ?? 'http://localhost:3000' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
