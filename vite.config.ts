/// <reference types="vitest" />
// From vitest/config, not vite: vite 8's UserConfigExport has no `test` key, so
// the block below is a TS2769 against vite's own overloads. Both exports are
// `config => config`; the emitted build is identical either way.
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/crypto-lab-timing-oracle/",
  test: {
    // The Playwright a11y spec lives in e2e/ and must not be collected by vitest.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
