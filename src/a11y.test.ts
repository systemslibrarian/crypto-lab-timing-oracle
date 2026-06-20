// @vitest-environment happy-dom
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initUi } from "./ui";

/**
 * Structural accessibility gate. happy-dom has no real layout engine, so rules
 * that need rendering (color-contrast) can't be evaluated here — those are
 * verified by the static audit. This catches the regressions that DO show up in
 * the DOM: missing labels, bad roles, broken landmarks, duplicate ids, lang, etc.
 */
function stubBrowser(): void {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "measureText") {
          return () => ({ width: 0 });
        }
        return () => undefined;
      },
      set: () => true
    }
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement["getContext"];

  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  });
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof window.requestAnimationFrame;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;

  // No-op observer: panels stay deferred, so axe scans the static shell.
  class NoopIO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.IntersectionObserver = NoopIO as unknown as typeof IntersectionObserver;
}

describe("accessibility (axe-core)", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.head.innerHTML = '<meta name="theme-color" content="#1e232b" />';
    document.body.innerHTML = '<div id="app"></div>';
    stubBrowser();
  });

  it("has no serious or critical axe violations after the UI renders", async () => {
    initUi();

    const results = await axe.run(document.body, {
      // color-contrast requires a real renderer; not measurable in happy-dom.
      rules: { "color-contrast": { enabled: false } }
    });

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    if (blocking.length > 0) {
      const report = blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join("\n");
      throw new Error(`axe found blocking violations:\n${report}`);
    }
    expect(blocking).toHaveLength(0);
  });
});
