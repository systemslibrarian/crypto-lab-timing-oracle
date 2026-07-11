/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "/crypto-lab-timing-oracle/",
  test: {
    // The Playwright a11y spec lives in e2e/ and must not be collected by vitest.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
