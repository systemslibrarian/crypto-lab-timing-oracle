import { defineConfig, devices } from '@playwright/test';

const devicesChromium = devices['Desktop Chrome'];

/**
 * Accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * The build runs as part of `webServer.command` — see the note there.
 */
const PORT = 4321;
const BASE = '/crypto-lab-timing-oracle/';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  webServer: {
    /*
     * Build first: `preview` only serves whatever is already in dist/. Without the
     * build, a failed compile leaves the previous good bundle on disk and the suite
     * passes green against source that no longer compiles, which silently
     * invalidates mutation checking. Building here makes a broken source abort the run.
     */
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devicesChromium } }],
});
