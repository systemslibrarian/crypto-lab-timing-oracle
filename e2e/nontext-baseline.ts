/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  /*
   * The two shared-top-bar controls: fill-less buttons whose 1px border is
   * their only delineator, at ~1.49:1. The same bar is baselined fleet-wide
   * (mac-race records it at 1.51) because the top bar is the shared header
   * design — brightening one lab's border is exactly the per-lab drift the
   * header policy warns against. Fix as a deliberate fleet pass, then delete
   * these two entries.
   */
  "control-boundary|a.cl-btn": { ratio: 1.49, required: 3.0, unverified: false },
  "control-boundary|button#cl-theme-toggle.cl-btn.cl-icon": { ratio: 1.49, required: 3.0, unverified: false },
  /*
   * The ✓ / ✗ / × marks are positioned ABOVE their host cell (top: -0.85rem on
   * a 2.1rem cell, so the glyph paints wholly outside it), and the oracle
   * measures a positioned pseudo-element against the host's backdrop — here the
   * tinted cell fill the glyph never touches. Hand-measured against the surface
   * they actually paint on (the .mechanism panel background), all three clear
   * 4.5:1 in both themes: ✓ #14683e ~6.0:1 light / #7ef7b1 ~10:1 dark,
   * ✗ #9f1d35 ~6.8:1, × #b94a00 ~4.6:1 light / #ffb469 ~7:1 dark. Kept as
   * unverified entries rather than deleted so the ratchet still catches these
   * marks getting WORSE.
   */
  "generated-content|span.mech-bit.mech-bit--1::after": { ratio: 3.55, required: 4.5, unverified: true },
  "generated-content|span.mech-cell.mech-cell--match::after": { ratio: 4.09, required: 4.5, unverified: true },
  "generated-content|span.mech-cell.mech-cell--mismatch::after": { ratio: 3.18, required: 4.5, unverified: true }
};
