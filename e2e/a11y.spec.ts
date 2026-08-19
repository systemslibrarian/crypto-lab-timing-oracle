import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where no
 * panel has been measured, all four measured-data disclosures are shut and the
 * compare exhibit sits in its length-gate branch — the shipped guess is one
 * character SHORTER than the secret, so zero character checks run and all 25
 * cells render as "never inspected"; both skip links focused; the compare grid
 * focused, which is the keyboard route into the only scroller that overflows at
 * 380px; Panel 1 measured, its data table and distribution revealed, the modeled
 * ideal signal overlaid, then the guess edited to the same length so matched,
 * mismatched and skipped cells render together and the verdict invalidates
 * itself, re-measured, replayed as an animation (which the Replay button
 * deliberately shows even under reduced motion), and driven to a full match;
 * Panel 2 measured, then fed a non-hex forged MAC so its `catch` branch renders
 * with nothing measured, then restored; Panel 3 measured and its
 * square-and-multiply schedule replayed across the generated key's exponent
 * bits; Panel 4 measured; every disclosure open at once; three hover states, one
 * focus ring on an input and one on a button. Every one of those states is
 * scanned, at desktop and phone width.
 *
 * One theme, not two: dark is the only theme this lab ships. It is pinned in
 * `index.html` before first paint, the lab's own toggle has been deleted rather
 * than hidden, and `boot()` asserts no theme control renders.
 *
 * See `gate.ts` for why nothing is injected into the page (`animate.ts` branches
 * on `matchMedia`, which a style tag cannot reach, so the old gate never once
 * scanned the reduced-motion rendering), why no disclosure is opened from
 * script, why the lab's defaults are asserted rather than assumed, and why
 * `violations` is not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
