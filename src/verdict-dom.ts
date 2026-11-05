import type { Verdict } from "./verdict";

/**
 * Renders a verdict into its panel WITHOUT innerHTML.
 *
 * `setVerdict` built this markup with a template literal:
 *
 *     node.innerHTML = `<strong>${icon} ${verdict.label}.</strong> ${verdict.detail}`;
 *
 * and CodeQL flagged it — js/xss-through-dom, high, src/ui.ts:115, raised
 * 2026-10-28. Its codeFlow is worth keeping, because it is the whole reason this
 * file exists: `error.textContent` is READ at ui.ts:587, interpolated into a
 * detail string, handed to setVerdict, and reinterpreted as HTML at the sink.
 * DOM text in, HTML out.
 *
 * Nothing a visitor types reaches it today. The only values that arrive are
 * literals from this codebase and Error messages whose own interpolations are
 * numeric — `${expectedMac.length * 2}` and a byte count — so the flow is
 * page-controlled and this fix is defence in depth rather than a closed hole.
 * It is still worth making structural: the sink accepted markup from a DOM read,
 * and the next detail string to quote an input would have had a script tag in it.
 *
 * The rendering is identical by construction: a <strong> carrying "icon label."
 * and a text node carrying " detail". No verdict in this lab contains markup —
 * checked across all 13 `detail:` sites — so nothing on the page changes.
 */
export function renderVerdict(node: HTMLElement, verdict: Verdict): void {
  node.className = `verdict verdict--${verdict.tone}`;
  const icon = verdict.tone === "leak" ? "⚠" : verdict.tone === "safe" ? "✓" : "•";
  const strong = document.createElement("strong");
  strong.textContent = `${icon} ${verdict.label}.`;
  node.replaceChildren(strong, document.createTextNode(` ${verdict.detail}`));
}
