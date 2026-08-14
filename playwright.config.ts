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
  /*
   * ONE worker, deliberately, in a lab about timing.
   *
   * Every panel here reports "Measured over N samples in this browser on this
   * machine", and `ui.ts` goes to the trouble of serialising the four panels
   * behind a page-wide queue so that claim holds. Running several browser
   * contexts of the same page at once puts several independent benchmark queues
   * on the same CPU and undoes that from the outside: `claims.spec.ts` asserts
   * on measured distributions, and the a11y gate now drives every panel in four
   * configurations. Contention has already invalidated timing findings elsewhere
   * in this fleet — a suite reported at 17.5 minutes ran in 15.6s alone.
   */
  workers: 1,
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
