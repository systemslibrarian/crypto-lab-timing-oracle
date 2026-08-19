import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec's
 *     `killMotion()` pushed `animation:none!important; transition:none!important;
 *     scroll-behavior:auto!important` through `addStyleTag`. That BYPASSES this
 *     lab's own `@media (prefers-reduced-motion: reduce)` block instead of
 *     exercising it — and on this page that block is not the only thing motion
 *     depends on. `animate.ts` reads `matchMedia('(prefers-reduced-motion:
 *     reduce)')` in JavaScript and, when it matches, SKIPS the whole stepping
 *     loop and calls `finish()` directly. A style tag cannot reach a
 *     `matchMedia` call, so the old gate always scanned the STEPPED rendering
 *     and never once scanned the reduced-motion end state that a reader with the
 *     preference set is the only rendering to ever see. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect, and injects nothing.
 *
 *  2. IT OPENED EVERY `<details>` FROM SCRIPT. `openAllDetails()` set
 *     `details.open = true` on all five disclosures before its only scan, so the
 *     SHUT state — which is what every reader sees on arrival, and the state the
 *     four `.chart-data` panels ship in — was never scanned at all. This gate
 *     opens each one by clicking its `<summary>`, which is the route a reader
 *     has, and scans before and after.
 *
 *  3. IT DROVE THE PANELS AND THEN THREW THE RESULT AWAY. `prepare()` clicked
 *     all four run buttons, opened the disclosures, and scanned ONCE at the end,
 *     so every intermediate rendering — the stale-verdict state after an input
 *     edit, the HMAC error branch, the length-gate walk, the replayed animation
 *     — was overwritten before anything measured it. And its light-theme test
 *     clicked the theme toggle and re-scanned WITHOUT re-driving. This drive
 *     names every control it touches, asserts a real completion signal after
 *     each, and scans after every step, in {dark, light} x {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. Every surface on this
 *     page that carries meaning is a `color-mix()` or a gradient — all three
 *     verdict tones, all three status pills, every painted compare cell, the
 *     mechanism frame, every button — and axe files all of them under
 *     `incomplete` rather than judging them. So does an `aria-label` on a
 *     role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The
 *     1.4.10 defect fixed in this repo earlier today — a bare `auto` grid track
 *     floored at the 837px min-content of the compare grid, scrolling a 380px
 *     viewport to 910px — was invisible to `withTags(TAGS)`, because axe has no
 *     reflow rule at all. `nontext.ts` adds the other two; see its header for
 *     why the `::after` marks above each compare cell are the half this lab
 *     cannot do without.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `main.css`'s
 * `* { animation: none !important; transition: none !important }` means
 * `getAnimations()` is normally empty and this returns on the sixth frame. It is
 * still load-bearing: the two Replay buttons DELIBERATELY bypass the
 * reduced-motion check (`animate.ts` sets `respectMotion` so an explicit press
 * still shows the animation), and that stepping is a `setTimeout` chain the
 * Animation API cannot see at all — which is why the drive additionally waits on
 * each stepper's own completion text rather than on this alone.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * `main.css` cannot currently be in that shape, and this assertion is what makes
 * that a measurement rather than a reading. Its reduced-motion block was read
 * declaration by declaration: it contains exactly `animation`, `transition` and
 * `scroll-behavior`, all `none`/`auto`, and nothing else — no `opacity`, no
 * `display`, no `transform`. The file declares no `@keyframes` at all. The check
 * runs in every state anyway, because all of that is a property of the current
 * stylesheet rather than of the page.
 *
 * `aria-hidden` subtrees are excluded; see the note on `ariaHidden` in
 * `contrast.ts` for the one thing this lab hides and why it was checked by hand.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page is
 * created. Three of this lab's four panels render their output from inside a
 * `try/catch` that paints an "inconclusive" verdict on failure, so a genuinely
 * thrown benchmark leaves a plausible-looking page behind that a gate would scan
 * and report green. Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * This page ships two `<header>`s: the shared `.cl-topbar` with an explicit
 * `role="banner"`, and the lab's own `.cl-hero`, which `ui.ts` renders as a
 * direct child of the `<div id="app">` — NOT inside sectioning content, so it
 * implies `banner` on its own. The single banner is therefore not a property of
 * the nesting here; it depends entirely on the shared bar's `dedupeBanner()`
 * demoting the hero to `role="group"`, which it does on `DOMContentLoaded`,
 * after the deferred module script has rendered the shell. Asserting the OUTCOME
 * rather than either mechanism is what catches a change to that ordering.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * An explicit role on a list REPLACES its implicit `list` role, orphaning every
 * `<li>` under it — and a redundant `role="list"` makes axe apply
 * `aria-required-children`, which fails whenever the list is empty. Neither is
 * reliably visible to a source grep, because a role can be assigned as a JS
 * property in an element-creation helper rather than as markup. Ask the DOM.
 *
 * This lab has three lists: `.rules` and `.hall` in Panel 5, and the `<ol>`/`<ul>`
 * pair carry no role. They are also never empty, so the second failure mode
 * cannot fire here today — which is a property of the content, not of the code,
 * and is exactly why the assertion is cheap enough to keep.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els.map(
      (e) => `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
    )
  );
  expect(broken, 'an explicit role on a list deletes its list semantics').toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. That assertion is load-bearing in this repo
 * beyond the usual: `animate.ts` branches on `matchMedia` in JavaScript, so if
 * the emulation silently failed the gate would scan the stepped animation while
 * claiming to scan the reduced-motion rendering.
 *
 * The theme is seeded through `localStorage` before the navigation, which is now
 * a test of the pin rather than a way of choosing a theme: no toggle exists to
 * click any more, and `index.html`'s boot script writes the literal `'dark'` over
 * whatever is stored before first paint. Seeding the key and then asserting
 * `data-theme` is therefore the check that a stored preference from a visitor's
 * past click cannot resurrect a light palette.
 *
 * The defaults are asserted at length because `ui.ts` builds the entire page
 * from `renderAppShell()` into an empty `<div id="app">`, and every panel's
 * benchmark is deferred behind an `IntersectionObserver` + `requestIdleCallback`
 * pair. A navigation that resolves proves nothing here: a render that threw
 * would leave `#app` empty, and an empty div is exactly what a scan reports as
 * perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.locator('#app .panel')).toHaveCount(5);

  // Both skip links exist and point at ids that exist. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run says
  // nothing about. This page has TWO, with DIFFERENT targets: the shared bar's
  // goes to `#app` and the lab's own goes to `#main-content`.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('#app')).toHaveCount(1);

  // ── No theme control renders at all ─────────────────────────────────────
  // Dark is the only theme, and this asserts that as a property of the page
  // rather than of one stylesheet. The shared bar still carries
  // `body :is(#theme-toggle,…) { display: none !important }`, but that rule is
  // now dead CSS: the lab's own toggle — a real `<button id="theme-toggle">`
  // whose handler flipped `data-theme` and persisted the choice to
  // `localStorage` — has been deleted, so nothing is left for it to hide. This
  // check is what makes that permanent. It looks for any element matching the
  // suppression rule's selector list, so a toggle reintroduced under any of
  // those names fails here even though the CSS would have hidden it, and it
  // reads the LIVE DOM after `renderAppShell()` rather than the source, which
  // is the only way to catch one rendered from script.
  expect(
    await page.evaluate(() =>
      document.querySelectorAll(
        '#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]'
      ).length
    ),
    'no theme control may render: this lab pins dark and ships no toggle'
  ).toBe(0);

  // ── Every shipped control default ───────────────────────────────────────
  // Which half of this lab a scan sees depends entirely on these. The default
  // guess is one character SHORTER than the secret, which puts the compare
  // exhibit in its length-gate branch: zero character checks run and all 25
  // cells render `.mech-cell--skipped`. Every `.mech-cell--match` and
  // `.mech-cell--mismatch` on the page is therefore only reachable by editing an
  // input, which the drive does.
  await expect(page.locator('#strcmp-target')).toHaveValue('timing-oracle-demo-secret');
  await expect(page.locator('#strcmp-guess')).toHaveValue('timing-oracle-demo-xxxxx');
  await expect(page.locator('#strcmp-modeled')).not.toBeChecked();
  await expect(page.locator('#hmac-message')).toHaveValue('POST /api/transfer?amount=1000');
  await expect(page.locator('#hmac-forged')).toHaveValue('0'.repeat(64));

  // The compare exhibit rendered synchronously at mount, in its length-gate
  // branch — asserted rather than assumed, because it is the arrival rendering.
  await expect(page.locator('#strcmp-mech .mech-cell')).toHaveCount(50); // 25 secret + 25 guess
  await expect(page.locator('#strcmp-mech [data-role=guess-row] .mech-cell--skipped')).toHaveCount(25);
  await expect(page.locator('#strcmp-mech [data-role=mech-status]')).toContainText('Lengths differ (25 vs 24)');

  // The exponent exhibit is seeded with a representative pattern before any key
  // exists, so Panel 3 is never blank on arrival.
  await expect(page.locator('#rsa-mech .mech-bit')).toHaveCount(10);

  // ── Four disclosures, all shut ──────────────────────────────────────────
  // The gate this replaces opened all of them from script before its only scan.
  await expect(page.locator('#app details')).toHaveCount(4);
  await expect(page.locator('#app details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, which is why the
 * 910px-at-380px defect fixed in this repo earlier today survived every green
 * run of the gate this replaces. Two shapes are at risk and both were the cause
 * then: `main` is a `display: grid` with no `grid-template-columns`, so it is an
 * implicit `auto` track floored at its widest item's min-content, and
 * `.mech-grid` is a grid ITEM whose automatic minimum size is the min-content of
 * its 837px `flex-wrap: nowrap` character row. The fixes were
 * `grid-template-columns: minmax(0, 1fr)` and `min-width: 0`; this is what stops
 * either from being quietly reverted.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. Every
    // `.mech-row` on this page is such a decoy once `.mech-grid` scrolls, and so
    // is every measured-data table inside its `.chart-data`.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab has two scrollers and they are handled differently, which is why the
 * assertion is on the OUTCOME rather than on either mechanism. `.mech-grid`
 * carries `tabindex="0"`, `role="region"` and an `aria-label` in `ui.ts`, and it
 * genuinely scrolls at 380px where at 1280px it usually does not — so the
 * requirement only exists in one of the two configurations this gate runs.
 * `.chart-data` is a `<details>`, whose `<summary>` is focusable, so it satisfies
 * the rule through its own content rather than through a `tabindex`.
 *
 * Note the ordering trap this guards: fixing 1.4.10 is what MAKES `.mech-grid`
 * scroll. Before the `min-width: 0` fix it grew to fit its content and never
 * overflowed, so a 2.1.1 requirement that now exists did not exist then.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden` DO
 * remove an element from the tab order, so those are skipped here rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: both skip links on this page have full opacity and a
 * real box, and each slides into view on focus. The drive scans both focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast, and
 * the arithmetic text walk cannot reach a control's boundary or a `::before`
 * glyph, because a pseudo-element is not an element and owns no text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide this
 * oracle had been called from inside `expectScrollersReachable`'s soft wrapper,
 * AFTER that wrapper's `if (!COLLECTING) return` guard — so in a strict run,
 * which is every run in CI and every run anyone reads as a pass, the guard
 * returned first and `nontext.ts` never executed at all. Thirteen repos
 * certified themselves clean on an oracle that had never looked. Calling it here
 * means it runs at every driven state, including `:hover`, and this repo's
 * baseline was captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything in
 * the baseline that has been FIXED fails until its entry is deleted. That last
 * rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Eight assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those ratios
 *    arithmetically — which matters more here than in most labs, because every
 *    meaningful surface on this page is a `color-mix()` or a gradient: all three
 *    verdict tones, all three status pills, the mechanism frame, every painted
 *    compare cell, every one-bit, the table header row, and every `button`. axe
 *    resolves none of them. Everything else in that bucket is a real result axe
 *    simply could not finish — including `aria-prohibited-attr`, which is where
 *    an `aria-label` on a role-less element hides, a defect that never reaches
 *    the violations array at all. This page depends on getting that right in
 *    several places: `.mech-grid` pairs its `aria-label` with `role="region"`,
 *    `.mech-bitrow` and `.cache-grid` pair theirs with `role="img"`, and every
 *    `<canvas>` pairs one with `role="img"`. Drop any of those roles and the
 *    label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it, and the only one that
 *    can see the ✓/✗/–/× marks the mechanism exhibits use as their non-colour
 *    cue.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads exactly
  // like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of axe-core
  // 4.12's 105 rule definitions; the chained form executes 4.
  //
  // Confirmed here by experiment rather than by reading: `<html lang="en">` was
  // changed to `<html>` and the full drive re-run against the identical page. The
  // merged form below failed on `html-has-lang` (SC 3.1.1, tagged `wcag2a`) at
  // the very first state. `landmark-one-main` would have been a vacuous proof —
  // it is one of the four rules the broken form already ran.
  //
  // The landmark four are still wanted because they are best-practice rather than
  // WCAG-tagged, so `withTags` alone does not reach them — and this page has the
  // shape they catch: a sticky `<header role="banner">` above a `<div id="app">`
  // that itself contains a `<header class="cl-hero">` with an
  // `<aside class="cl-hero-why">` inside it, plus two `<nav>`s and a
  // `<footer>` sibling.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr` and
  // `aria-required-children` appear ONLY here — never in `violations` — so a gate
  // that ignores this bucket cannot see either. Only `color-contrast` is allowed
  // to remain, and only because the arithmetic walk below judges those ratios
  // for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Run one panel's benchmark and wait for it to finish.
 *
 * `withRunning()` opens with `if (button.dataset.running === "true") return`, so
 * a click that lands while the panel's own lazy auto-run is in flight SILENTLY
 * DOES NOTHING — the re-entrancy guard sits inside the step rather than on the
 * click. A drive that clicked and then waited for a completion signal would sail
 * straight through, having driven nothing, because the auto-run's own completion
 * satisfies the wait.
 *
 * So the click is PROVED to have started a run rather than assumed: a
 * `MutationObserver` armed before the click latches the moment `aria-busy`
 * appears, which `withRunning` sets only on the panel's own turn at the
 * page-wide benchmark queue. A latch cannot be missed the way a poll can, and
 * `aria-busy` is a signal only a real run produces.
 */
async function runPanel(page: Page, id: string): Promise<void> {
  const button = page.locator(id);
  await expect(button).toBeEnabled({ timeout: 120_000 });
  await button.scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no such control: ${sel}`);
    (window as unknown as { __ranBusy?: boolean }).__ranBusy = false;
    const obs = new MutationObserver(() => {
      if (el.getAttribute('aria-busy') === 'true') {
        (window as unknown as { __ranBusy?: boolean }).__ranBusy = true;
        obs.disconnect();
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['aria-busy'] });
  }, id);
  await button.click();
  await expect(button).toBeEnabled({ timeout: 120_000 });
  expect(
    await page.evaluate(() => (window as unknown as { __ranBusy?: boolean }).__ranBusy),
    `${id} must have actually started a benchmark, not been swallowed by withRunning()'s re-entrancy guard`
  ).toBe(true);
}

/** Wait for a panel's deferred auto-run to land, without racing it. */
async function awaitAutoRun(page: Page, buttonId: string, verdictId: string): Promise<void> {
  // Scrolling the panel into view is what arms its IntersectionObserver.
  await page.locator(buttonId).scrollIntoViewIfNeeded();
  await expect(page.locator(verdictId)).not.toBeEmpty({ timeout: 120_000 });
  await expect(page.locator(buttonId)).toBeEnabled({ timeout: 120_000 });
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED BEFORE ANYTHING IS DRIVEN, with every
 *    `<details>` shut and no measurement rendered. The gate this replaces opened
 *    all five from script and ran all four benchmarks before its only scan, so
 *    the state every reader actually arrives in was never measured.
 *
 *  - THE DEFAULT GUESS IS THE WRONG LENGTH, which puts Panel 1's compare exhibit
 *    in its length-gate branch: zero character checks run and all 25 cells are
 *    `.mech-cell--skipped`. `.mech-cell--match` and `.mech-cell--mismatch` are
 *    reachable ONLY by editing an input to a same-length guess, so a gate that
 *    scans the shipped page scans one third of that exhibit's states. All three
 *    are driven, plus the full-match case.
 *
 *  - EVERY ERROR AND STALE STATE. Editing an input after a measurement replaces
 *    the whole panel with `STALE_VERDICT` — a real rendering with its own tone
 *    and its own emptied chart. Feeding Panel 2 a non-hex forged MAC takes the
 *    `catch` branch, which paints `#hmac-error` and a "Run failed — nothing
 *    measured" verdict. Neither is reachable without typing something wrong on
 *    purpose, and neither had ever been looked at.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the state
 *    a reader occupies the instant after pressing Run. `.cl-btn:hover` in the
 *    shared bar repaints its fill, and it is scanned explicitly; a run button and
 *    a related-demo chip are hovered too, so a hover rule added to either is
 *    measured the day it lands rather than the next time someone remembers.
 *
 *  - THE REPLAY BUTTONS BYPASS REDUCED MOTION ON PURPOSE. `animate.ts` sets its
 *    `respectMotion` flag around an explicit press, so a Replay steps the
 *    animation even for a reader with the preference set. That is a defensible
 *    design — the press IS the request to see it — and it means the stepped
 *    renderings are real states this gate must reach. It waits on each stepper's
 *    own completion text, not on a timeout.
 *
 *  - NO FIXED TIMEOUTS. Every wait here is on a real DOM completion signal: a
 *    verdict becoming non-empty, a button leaving its disabled state, a status
 *    paragraph reaching its finished wording, a cell count.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const SECRET = 'timing-oracle-demo-secret';

  await scanAt('arrival, all disclosures shut and the compare exhibit at its length gate');

  // ── The two skip links, focused ─────────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('shared skip link focused, slid into view');

  await page.locator('a.skip-link').focus();
  await expect(page.locator('a.skip-link')).toBeFocused();
  await scanAt('the lab own skip link focused, slid in from left:-9999px');

  // ── Panel 1: string comparison ──────────────────────────────────────────
  await awaitAutoRun(page, '#strcmp-run', '#strcmp-verdict');
  await scanAt('Panel 1 measured on the shipped length-mismatched guess');

  await page.locator('#strcmp-mech .mech-grid').focus();
  await expect(page.locator('#strcmp-mech .mech-grid')).toBeFocused();
  await scanAt('the compare grid focused — the keyboard route into the only scroller at 380px');

  await page.locator('#app details').first().locator('summary').click();
  await expect(page.locator('#app details[open]')).toHaveCount(1);
  await expect(page.locator('#strcmp-table table')).toBeVisible();
  await scanAt('Panel 1 measured-data table and distribution histogram revealed');

  await page.check('#strcmp-modeled');
  await expect(page.locator('#strcmp-modeled')).toBeChecked();
  await scanAt('Panel 1 with the modeled ideal signal overlaid');
  await page.uncheck('#strcmp-modeled');

  // A same-length guess is the only way to reach `.mech-cell--match` and
  // `.mech-cell--mismatch`, and editing an input is also what renders
  // STALE_VERDICT. Both in one step.
  await page.fill('#strcmp-guess', 'timing-Xracle-demo-secret');
  await expect(page.locator('#strcmp-mech [data-role=guess-row] .mech-cell--match')).toHaveCount(7);
  await expect(page.locator('#strcmp-mech [data-role=guess-row] .mech-cell--mismatch')).toHaveCount(1);
  await expect(page.locator('#strcmp-mech [data-role=guess-row] .mech-cell--skipped')).toHaveCount(17);
  await expect(page.locator('#strcmp-verdict')).toContainText('Inputs changed — not measured yet');
  await scanAt('Panel 1 inputs edited: matched, mismatched and skipped cells together, verdict invalidated');

  await runPanel(page, '#strcmp-run');
  await expect(page.locator('#strcmp-verdict')).not.toContainText('Inputs changed');
  await scanAt('Panel 1 re-measured on the edited same-length guess');

  // The Replay button deliberately bypasses reduced motion; wait on the
  // stepper's own finished wording rather than on a timeout.
  await page.click('#strcmp-mech-play');
  await expect(page.locator('#strcmp-mech [data-role=mech-status]')).toContainText(
    'Vulnerable loop bailed out at character 8 of 25',
    { timeout: 60_000 }
  );
  await scanAt('Panel 1 compare animation replayed to its end state, Replay still hovered from the click');

  await page.fill('#strcmp-guess', SECRET);
  await expect(page.locator('#strcmp-mech [data-role=mech-status]')).toContainText('Full match');
  await expect(page.locator('#strcmp-mech [data-role=guess-row] .mech-cell--match')).toHaveCount(25);
  await scanAt('Panel 1 with a fully correct guess — the slowest case, every cell matched');

  await page.fill('#strcmp-guess', 'timing-oracle-demo-xxxxx');
  await expect(page.locator('#strcmp-mech [data-role=mech-status]')).toContainText('Lengths differ');

  // ── Panel 2: HMAC verification, including its error branch ──────────────
  await awaitAutoRun(page, '#hmac-run', '#hmac-verdict');
  await scanAt('Panel 2 measured');

  await page.locator('#app details').nth(1).locator('summary').click();
  await expect(page.locator('#hmac-table table')).toBeVisible();
  await scanAt('Panel 2 measured-data table revealed');

  await page.fill('#hmac-forged', 'not-hex');
  await expect(page.locator('#hmac-verdict')).toContainText('Inputs changed — not measured yet');
  await runPanel(page, '#hmac-run');
  await expect(page.locator('#hmac-error')).not.toBeEmpty();
  await expect(page.locator('#hmac-verdict')).toContainText('Run failed — nothing measured');
  await scanAt('Panel 2 rejected a non-hex forged MAC — the error branch, nothing measured');

  await page.fill('#hmac-forged', '0'.repeat(64));
  await runPanel(page, '#hmac-run');
  await expect(page.locator('#hmac-error')).toBeEmpty();
  await scanAt('Panel 2 restored and re-measured');

  // ── Panel 3: RSA exponent bits ──────────────────────────────────────────
  await awaitAutoRun(page, '#rsa-run', '#rsa-verdict');
  await expect(page.locator('#rsa-mech .mech-bit')).toHaveCount(10);
  await scanAt('Panel 3 measured, the exponent row showing the generated key bits');

  await page.locator('#app details').nth(2).locator('summary').click();
  await expect(page.locator('#rsa-table table')).toBeVisible();
  await scanAt('Panel 3 measured-data table revealed');

  await page.click('#rsa-mech-play');
  await expect(page.locator('#rsa-mech [data-role=exp-status]')).toContainText(
    'multiply count IS the secret',
    { timeout: 60_000 }
  );
  await scanAt('Panel 3 square-and-multiply animation replayed to its end state');

  // ── Panel 4: cache timing ───────────────────────────────────────────────
  await awaitAutoRun(page, '#cache-run', '#cache-verdict');
  await scanAt('Panel 4 measured');

  await page.locator('#app details').nth(3).locator('summary').click();
  await expect(page.locator('#app details[open]')).toHaveCount(4);
  await expect(page.locator('#cache-table table')).toBeVisible();
  await scanAt('every measured-data disclosure open at once');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.locator('#cache-run').hover();
  await scanAt('a run button hovered');

  await page.locator('.links a').first().hover();
  await scanAt('a Panel 5 related-demo chip hovered');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.locator('#strcmp-target').focus();
  await expect(page.locator('#strcmp-target')).toBeFocused();
  await scanAt('a text input focused, showing its focus-visible outline');

  await page.locator('#cache-run').focus();
  await scanAt('a run button focused, showing its focus-visible outline');
}
