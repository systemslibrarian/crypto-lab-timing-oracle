// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { renderVerdict } from "./verdict-dom";

describe("rendering a verdict", () => {
  it("renders the icon, label and detail exactly as the panel always read", () => {
    const node = document.createElement("div");
    renderVerdict(node, { tone: "leak", label: "Leak detected", detail: "The gap is 31%." });

    expect(node.className).toBe("verdict verdict--leak");
    expect(node.querySelector("strong")?.textContent).toBe("⚠ Leak detected.");
    expect(node.textContent).toBe("⚠ Leak detected. The gap is 31%.");
    // One element, one text node: the shape the old template produced.
    expect(node.childNodes).toHaveLength(2);
  });

  it("writes a detail that looks like markup as TEXT, creating no element from it", () => {
    const node = document.createElement("div");
    const payload = '<img src=x onerror="document.title=\'xss\'">';
    renderVerdict(node, {
      tone: "inconclusive",
      label: "Run failed — nothing measured",
      detail: `${payload} No timing was recorded this run.`
    });

    // The assertion that bites: with innerHTML this <img> is an element, and its
    // onerror attribute is live.
    expect(node.querySelectorAll("img")).toHaveLength(0);
    expect(node.querySelector("[onerror]")).toBeNull();
    expect(node.textContent).toContain(payload);
  });

  it("writes a label that looks like markup as text too", () => {
    const node = document.createElement("div");
    renderVerdict(node, { tone: "safe", label: "<script>document.title='x'</script>", detail: "fine" });

    expect(node.querySelectorAll("script")).toHaveLength(0);
    expect(node.querySelector("strong")?.textContent).toBe("✓ <script>document.title='x'</script>.");
  });

  it("replaces a previous verdict rather than appending to it", () => {
    const node = document.createElement("div");
    renderVerdict(node, { tone: "leak", label: "First", detail: "one" });
    renderVerdict(node, { tone: "safe", label: "Second", detail: "two" });

    expect(node.childNodes).toHaveLength(2);
    expect(node.textContent).toBe("✓ Second. two");
    expect(node.className).toBe("verdict verdict--safe");
  });
});
