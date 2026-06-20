// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initUi } from "./ui";

/** Minimal canvas 2D context — enough for the chart renderers to run headless. */
function stubCanvas(): void {
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "measureText") {
          return () => ({ width: 0 });
        }
        if (prop === "canvas") {
          return undefined;
        }
        return () => undefined;
      },
      set() {
        return true;
      }
    }
  );
  // happy-dom canvases have no real 2D context; hand the renderers a no-op one.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement["getContext"];
}

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor timed out"));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

describe("initUi integration", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    stubCanvas();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
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
  });

  it("renders the shell and wires every panel without throwing on missing elements", () => {
    expect(() => initUi()).not.toThrow();
    // All panels and their new verdict/table containers must exist.
    for (const id of [
      "strcmp-verdict",
      "strcmp-table",
      "hmac-verdict",
      "hmac-table",
      "rsa-verdict",
      "rsa-table",
      "cache-verdict",
      "cache-table"
    ]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it("runs the string panel end-to-end: chart data table and a verdict are produced", async () => {
    initUi();
    await waitFor(() => Boolean(document.querySelector("#strcmp-table table")));

    const table = document.querySelector("#strcmp-table table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("tbody tr").length).toBeGreaterThan(0);

    const verdict = document.getElementById("strcmp-verdict");
    expect(verdict?.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(verdict?.className).toContain("verdict--");
  });

  it("toggles theme and updates the theme-color meta tag", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#1e232b" />';
    initUi();
    const toggle = document.getElementById("theme-toggle") as HTMLButtonElement;
    const before = document.documentElement.getAttribute("data-theme");
    toggle.click();
    const after = document.documentElement.getAttribute("data-theme");
    expect(after).not.toBe(before);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBeTruthy();
  });
});
