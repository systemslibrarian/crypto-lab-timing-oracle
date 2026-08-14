import { expect, test, type Page } from '@playwright/test';

/**
 * Functional gate for the claims this page makes on screen.
 *
 * The a11y spec proves the page is reachable; this one proves it is HONEST:
 * every verdict is recomputed from the numbers the page itself rendered (never
 * matched against a hardcoded sentence), the deterministic mechanism counters
 * are checked for internal consistency (parts summing to the whole), and every
 * failure path is driven until it both reaches the failure state and names its
 * cause. Any uncaught page exception fails the test that provoked it.
 *
 * Reduced motion is emulated so the mechanism animations settle on their final
 * state synchronously — the counts asserted here are instruction counts, not
 * frames, and are exact for a given pair of inputs.
 */

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`);
    }
  });
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], 'uncaught page errors').toEqual([]);
});

/** Scroll a panel into view and wait for its lazy auto-run to finish. */
async function settle(page: Page, buttonSel: string, verdictSel: string): Promise<void> {
  await page.locator(buttonSel).scrollIntoViewIfNeeded();
  await expect(page.locator(verdictSel)).not.toBeEmpty({ timeout: 90_000 });
  await expect(page.locator(buttonSel)).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator(buttonSel)).not.toHaveAttribute('aria-busy', 'true');
}

/** Press a panel's run button and wait for the benchmark to complete. */
async function rerun(page: Page, buttonSel: string): Promise<void> {
  const button = page.locator(buttonSel);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled({ timeout: 90_000 });
  await button.click();
  await expect(button).not.toHaveAttribute('aria-busy', 'true', { timeout: 90_000 });
  await expect(button).toBeEnabled({ timeout: 90_000 });
}

async function openPage(page: Page): Promise<void> {
  // Settle the mechanism animations on their final state before the first
  // render, so the counters assert instruction counts rather than frames.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  await expect(page.locator('#main-content')).toBeVisible();
}

/** Read a rendered data table as numbers keyed by first column. */
/**
 * Width of the private-exponent window the RSA mechanism panel renders. Kept in
 * step with EXPONENT_WINDOW_BITS in src/rsa.ts.
 */
const RSA_WINDOW_BITS = 10;

async function tableRows(page: Page, sel: string): Promise<string[][]> {
  return page.locator(`${sel} tbody tr`).evaluateAll((rows) =>
    rows.map((row) => Array.from((row as HTMLTableRowElement).cells).map((cell) => cell.textContent ?? ''))
  );
}

function num(text: string | null, pattern: RegExp, label: string): number {
  const match = pattern.exec(text ?? '');
  expect(match, `${label} not found in: ${text}`).not.toBeNull();
  const value = Number(match![1]);
  expect(Number.isFinite(value), `${label} was not a number: ${match![1]}`).toBe(true);
  return value;
}

/**
 * HMAC-SHA256 of `message` under the panel's public demo key, computed in the
 * browser independently of the page's own code, so "the panel shows the MAC of
 * THIS message" is checked against a value the panel did not produce.
 */
async function macHex(page: Page, message: string): Promise<string> {
  return page.evaluate(async (msg) => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('crypto-lab-timing-oracle-demo-key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
    return Array.from(mac)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }, message);
}

/** 4-decimal rendering plus float noise; never wide enough to hide a sign flip. */
const EPS = 0.01;

/** Largest error a rendered decimal can be hiding, from its own precision. */
function halfUlp(rendered: string): number {
  const dot = rendered.indexOf('.');
  return dot < 0 ? 0.5 : 0.5 * 10 ** -(rendered.length - dot - 1);
}

test('panel 1 mechanism counts the exact characters the compare loop inspects', async ({ page }) => {
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');

  // 8-char secret, first 4 characters guessed right: the vulnerable loop must
  // inspect exactly 5 (4 matches + the one that fails) and skip the other 3.
  await page.fill('#strcmp-target', 'abcdefgh');
  await page.fill('#strcmp-guess', 'abcdWXYZ');

  const cells = await page
    .locator('#strcmp-mech [data-role=guess-row] .mech-cell')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.mark ?? ''));

  const matched = cells.filter((m) => m === '✓').length;
  const mismatched = cells.filter((m) => m === '✗').length;
  const skipped = cells.filter((m) => m === '–').length;

  expect(cells.length, 'one cell per secret character').toBe(8);
  expect(matched).toBe(4);
  expect(mismatched).toBe(1);
  // Parts sum to the whole: every position is accounted for exactly once.
  expect(matched + mismatched + skipped, 'cells accounted for').toBe(cells.length);
  expect(skipped).toBe(3);

  const vuln = await page.locator('#strcmp-mech [data-role=vuln-count]').textContent();
  const constant = await page.locator('#strcmp-mech [data-role=ct-count]').textContent();
  // The counter must equal the cells actually inspected, not a separate tally.
  expect(Number(vuln), 'vulnerable character checks = inspected cells').toBe(matched + mismatched);
  // The defense: the constant-time count is the full length regardless of input.
  expect(Number(constant), 'constant-time character checks = full length').toBe(cells.length);

  const status = await page.locator('#strcmp-mech [data-role=mech-status]').textContent();
  expect(status).toContain(`bailed out at character ${matched + mismatched} of ${cells.length}`);
  expect(status).toContain(`only ${matched + mismatched} character checks ran`);
  expect(status).toContain(`always runs ${cells.length}`);

  // Second surface, same run: the benchmark's own shared-prefix length must
  // agree with where the mechanism said the loop stopped.
  await rerun(page, '#strcmp-run');
  const summary = await page.locator('#strcmp-summary').textContent();
  expect(summary).toContain(`Prefix match length: ${matched} chars`);

  // A full match is the slowest case, and the mechanism must say so.
  await page.fill('#strcmp-guess', 'abcdefgh');
  const fullStatus = await page.locator('#strcmp-mech [data-role=mech-status]').textContent();
  expect(fullStatus).toContain('Full match');
  expect(await page.locator('#strcmp-mech [data-role=vuln-count]').textContent()).toBe('8');
});

test('panel 1 mechanism reports zero checks when the length gate fires', async ({ page }) => {
  // Regression: the real comparator opens with
  //   if (a.length !== b.length) return false;
  // so a wrong-length guess runs ZERO character comparisons. The model walked
  // the string anyway and reported the count it WOULD have run — across a
  // 124-guess corpus reachable by editing the shipped defaults, 98 differed in
  // length and every one was overstated. The worst case is the interesting one:
  // guessing the secret minus its final character showed 25 checks for a
  // comparator that ran none, under a panel captioned "exact every run".
  //
  // The older test for this panel used 'abcdefgh' / 'abcdWXYZ' — equal length,
  // the one case the count was right for.
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');

  await page.fill('#strcmp-target', 'abcdefgh');
  await page.fill('#strcmp-guess', 'abcdefg'); // a proper prefix: one shorter

  const cells = await page
    .locator('#strcmp-mech [data-role=guess-row] .mech-cell')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.mark ?? ''));
  expect(cells.length, 'the row still shows every position').toBeGreaterThan(0);
  expect(
    cells.filter((m) => m === '–').length,
    'no position may be marked inspected when the loop never ran',
  ).toBe(cells.length);

  const vuln = await page.locator('#strcmp-mech [data-role=vuln-count]').textContent();
  expect(Number(vuln), 'the vulnerable loop was never entered').toBe(0);

  // The defense still scans everything — the count that does NOT move.
  const constant = await page.locator('#strcmp-mech [data-role=ct-count]').textContent();
  expect(Number(constant), 'constant-time still walks the full width').toBe(cells.length);

  const status = await page.locator('#strcmp-mech [data-role=mech-status]').textContent();
  expect(status, 'the narration must name the length check').toContain('Lengths differ');
  expect(status).toContain('never enters the loop');
  expect(status, 'and must not narrate a bail-out that did not happen').not.toContain('bailed out');
  // What the gate actually leaks is the length, and the panel must say so.
  expect(status).toContain("secret's LENGTH");

  // Same-length guess, same panel: the counter must come back to a real count.
  await page.fill('#strcmp-guess', 'abcdefgX');
  expect(
    Number(await page.locator('#strcmp-mech [data-role=vuln-count]').textContent()),
    'an equal-length guess re-enters the loop',
  ).toBe(8);
});

test('panel 1 verdict follows the timing gap the same panel reported', async ({ page }) => {
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');

  const summary = await page.locator('#strcmp-summary').textContent();
  const verdict = await page.locator('#strcmp-verdict').textContent();
  const tone = await page.locator('#strcmp-verdict').getAttribute('class');

  // ms the vulnerable batch gained from a short prefix to a full one.
  const gain = num(summary, /changed the vulnerable batch time by (-?[\d.]+) ms/u, 'sweep gain');
  const comparisons = Number(
    /over ([\d,]+) comparisons/u.exec(summary ?? '')?.[1].replace(/,/gu, '') ?? NaN
  );
  expect(comparisons, 'batch size the gain is spread over').toBeGreaterThan(0);

  if (tone?.includes('verdict--leak')) {
    const pct = num(verdict, /rose ~(-?[\d.]+)%/u, 'verdict percentage');
    // A positive-tone verdict is only honest if the measured runtime actually
    // ROSE and cleared the panel's own 15% threshold.
    expect(gain, 'leak verdict requires a positive gain').toBeGreaterThan(0);
    expect(pct).toBeGreaterThanOrEqual(15 - EPS * 100);
    // ...and it must claim only what one threshold crossing can support. This
    // panel compares two means from a fixed sample count on one loaded machine;
    // that is evidence of a distinguishable difference here, not a demonstrated
    // key recovery, and the wording has to say so.
    expect(verdict, 'leak verdict must not claim the secret was recovered').not.toMatch(
      /an attacker can recover the secret/iu
    );
    expect(verdict, 'leak verdict must disclaim attempting the recovery').toMatch(
      /never attempts the recovery/u
    );
    // The flatness claim must be a measurement, not an assertion: the verdict
    // has to report how much the constant-time sweep actually moved, and a
    // leak verdict is only honest if that movement was smaller than the
    // vulnerable rise (1% slack for the rendered rounding).
    const ctPct = num(verdict, /moved ~(-?[\d.]+)%/u, 'constant-time movement');
    expect(verdict, 'no unmeasured flatness claims').not.toMatch(/stayed flat/iu);
    expect(ctPct, 'leak verdict requires the constant-time path to have moved less').toBeLessThanOrEqual(pct + 1);
  } else if (verdict?.includes('Both paths drifted')) {
    // The vulnerable rise cleared the threshold, but the constant-time sweep
    // moved as much or more — the panel must refuse to call that a leak.
    const pct = num(verdict, /rose ~(-?[\d.]+)%/u, 'vulnerable rise');
    const ctPct = num(verdict, /moved ~(-?[\d.]+)%/u, 'constant-time movement');
    expect(gain, 'drifted verdict still requires a positive vulnerable gain').toBeGreaterThan(0);
    expect(pct).toBeGreaterThanOrEqual(15 - EPS * 100);
    expect(ctPct, 'drifted verdict requires the constant-time path to have moved as much').toBeGreaterThanOrEqual(pct - 1);
  } else {
    const pct = num(verdict, /effect was ~(-?[\d.]+)%/u, 'verdict percentage');
    expect(
      gain <= 0 || pct <= 15 + EPS * 100,
      `inconclusive verdict but gain=${gain} pct=${pct}`
    ).toBe(true);
  }

  // Whichever way it landed, the verdict states the sample count it measured
  // over, and that count is the one the panel actually collected — a verdict
  // that named a fixed number would be describing a run it did not perform.
  const scoped = num(verdict, /Measured over (\d+) samples/u, 'verdict sample count');
  const perMode = Number(
    /([\d,]+) real comparisons per mode/u.exec(summary ?? '')?.[1].replace(/,/gu, '') ?? NaN
  );
  expect(perMode, 'comparisons per mode').toBeGreaterThan(0);
  expect(scoped).toBeGreaterThan(0);
  expect(scoped, 'verdict sample count must not exceed the comparisons performed').toBeLessThanOrEqual(perMode);

  // The chart's own data table must cover the sweep the summary describes.
  const rows = await tableRows(page, '#strcmp-table');
  expect(rows.length).toBeGreaterThan(1);
  const prefixes = rows.map((r) => Number(r[0]));
  expect(prefixes[0]).toBe(0);
  expect(prefixes[prefixes.length - 1]).toBe(25); // default secret length
  expect([...prefixes].sort((a, b) => a - b), 'prefix column is ascending').toEqual(prefixes);
});

test('panel 2 shows the real HMAC of the message and a verdict its own numbers support', async ({ page }) => {
  await openPage(page);
  await settle(page, '#hmac-run', '#hmac-verdict');

  const message = await page.locator('#hmac-message').inputValue();
  // Independently compute HMAC-SHA-256 under the demo key and require the panel
  // to be displaying that MAC — not merely "some 64 hex characters".
  const trueMac = await page.evaluate(async (msg) => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('crypto-lab-timing-oracle-demo-key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
    return Array.from(mac)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }, message);

  const summary = await page.locator('#hmac-summary').textContent();
  expect(summary).toContain(`Expected MAC (first 16 hex): ${trueMac.slice(0, 16)}`);

  const rows = await tableRows(page, '#hmac-table');
  expect(rows.map((r) => Number(r[0])), 'prefix byte counts').toEqual([0, 4, 8, 12, 16]);

  const baseline = Number(rows[0][1]);
  const vulnSlope = num(summary, /Prefix slope vulnerable=(-?[\d.]+) ms/u, 'vulnerable slope');
  const constSlope = num(summary, /constant-time=(-?[\d.]+) ms\.$/u, 'constant-time slope');
  // The slope is the endpoint difference of the same table, so the two surfaces
  // must agree about the run.
  expect(Math.abs(vulnSlope - (Number(rows[4][1]) - Number(rows[0][1]))), 'slope matches table').toBeLessThan(EPS);
  expect(Math.abs(constSlope - (Number(rows[4][2]) - Number(rows[0][2]))), 'slope matches table').toBeLessThan(EPS);

  const ratio = Math.abs(vulnSlope) / Math.max(baseline, 1e-9);
  const tone = await page.locator('#hmac-verdict').getAttribute('class');
  if (tone?.includes('verdict--leak')) {
    expect(vulnSlope, 'leak requires time RISING with correct bytes').toBeGreaterThan(0);
    expect(Math.abs(vulnSlope)).toBeGreaterThan(Math.abs(constSlope) - EPS);
    expect(ratio).toBeGreaterThanOrEqual(0.15 - EPS);
  } else {
    expect(
      vulnSlope <= 0 || ratio <= 0.15 + EPS || Math.abs(vulnSlope) <= Math.abs(constSlope) + EPS,
      `inconclusive verdict but vulnSlope=${vulnSlope} constSlope=${constSlope} ratio=${ratio}`
    ).toBe(true);
  }
});

test('panel 3 multiply counts equal the exponent Hamming weight the page rendered', async ({ page }) => {
  await openPage(page);
  await settle(page, '#rsa-run', '#rsa-verdict');

  const bits = await page
    .locator('#rsa-mech [data-role=bit-row] .mech-bit')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).textContent ?? ''));
  expect(bits.length).toBeGreaterThan(0);
  expect(bits.every((b) => b === '0' || b === '1'), 'bit row holds only bits').toBe(true);

  const ones = bits.filter((b) => b === '1').length;
  const zeros = bits.filter((b) => b === '0').length;
  expect(ones + zeros, 'bits accounted for').toBe(bits.length);

  const naive = await page.locator('#rsa-mech [data-role=naive-tally]').textContent();
  const ladder = await page.locator('#rsa-mech [data-role=ladder-tally]').textContent();
  // THE claim of the panel: naive multiplies == Hamming weight (secret-dependent),
  // ladder multiplies == bit length (secret-independent).
  expect(naive).toBe(`${bits.length} squares · ${ones} multiplies`);
  expect(ladder).toBe(`${bits.length} squares · ${bits.length} multiplies`);
  // Both assertions above are true of ANY bit row, so on their own they cannot
  // tell whether the row is the fixed window the caption promises. Pin the width.
  expect(bits.length, 'the panel renders a fixed-width window').toBe(RSA_WINDOW_BITS);

  const status = await page.locator('#rsa-mech [data-role=exp-status]').textContent();
  expect(status).toContain(`Naive did ${ones} multiplies for ${ones} one-bits`);
  expect(status).toContain(`ladder did ${bits.length} multiplies`);

  // The panel prints the result of an actual encrypt/decrypt round trip; a FAIL
  // would mean the timed routines are not computing RSA at all.
  const summary = await page.locator('#rsa-summary').textContent();
  expect(summary).toContain('round trip=PASS');

  const rows = await tableRows(page, '#rsa-table');
  const byLabel = new Map(rows.map((r) => [r[0], Number(r[1])]));
  expect([...byLabel.keys()]).toEqual([
    'Naive bit=0',
    'Naive bit=1',
    'Ladder bit=0',
    'Ladder bit=1',
    'WebCrypto RSA-PSS sign'
  ]);
  const naiveGap = Math.abs(byLabel.get('Naive bit=1')! - byLabel.get('Naive bit=0')!);
  const ladderGap = Math.abs(byLabel.get('Ladder bit=1')! - byLabel.get('Ladder bit=0')!);
  expect(Math.abs(num(summary, /Naive gap=(-?[\d.]+) ms/u, 'naive gap') - naiveGap)).toBeLessThan(EPS);
  expect(Math.abs(num(summary, /ladder gap=(-?[\d.]+) ms/u, 'ladder gap') - ladderGap)).toBeLessThan(EPS);

  const naiveRel = naiveGap / Math.max(byLabel.get('Naive bit=0')!, 1e-9);
  const verdict = await page.locator('#rsa-verdict').textContent();
  const tone = await page.locator('#rsa-verdict').getAttribute('class');
  if (tone?.includes('verdict--leak')) {
    expect(naiveGap, 'naive must leak MORE than the ladder').toBeGreaterThan(ladderGap);
    const claimed = num(verdict, /gap ~(-?[\d.]+)%/u, 'claimed naive percentage');
    expect(Math.abs(claimed - naiveRel * 100), 'verdict % matches the table').toBeLessThan(1.5);
    expect(claimed).toBeGreaterThanOrEqual(15 - EPS * 100);
  } else {
    expect(
      naiveRel <= 0.15 + EPS || naiveGap <= ladderGap,
      `inconclusive verdict but naiveRel=${naiveRel} naiveGap=${naiveGap} ladderGap=${ladderGap}`
    ).toBe(true);
  }
});

test('panel 3 ladder tally does not move across freshly generated keys', async ({ page }) => {
  // Regression: the panel says the ladder does one square and one multiply per
  // bit "no matter the bit values", but it rendered bitsOf(d & 0x3ff), which
  // strips leading zeros — so the rendered width, and with it the ladder tally,
  // was a function of the top bit's VALUE. Sampling the window uniformly, 1027
  // of 2000 draws rendered fewer than 10 positions and the on-screen ladder
  // tally ranged over all ten values from 1 to 10, directly contradicting the
  // sentence beneath it.
  //
  // The unit test that covered this picked 0b10000000 and 0b11111111 — both
  // with the top bit set, the only case where the width survives.
  await openPage(page);
  await settle(page, '#rsa-run', '#rsa-verdict');

  const ladderTallies = new Set<string>();
  const naiveTallies = new Set<string>();
  const widths = new Set<number>();
  const RUNS = 4;

  for (let i = 0; i < RUNS; i += 1) {
    if (i > 0) {
      await rerun(page, '#rsa-run'); // generates a brand new toy key
    }
    const bits = await page
      .locator('#rsa-mech [data-role=bit-row] .mech-bit')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).textContent ?? ''));
    expect(bits.length, 'a bit row must be rendered').toBeGreaterThan(0);
    widths.add(bits.length);
    ladderTallies.add((await page.locator('#rsa-mech [data-role=ladder-tally]').textContent()) ?? '');
    naiveTallies.add((await page.locator('#rsa-mech [data-role=naive-tally]').textContent()) ?? '');
  }

  expect(widths.size, `every run must render the same width, saw ${[...widths]}`).toBe(1);
  expect([...widths][0]).toBe(RSA_WINDOW_BITS);
  expect(
    ladderTallies.size,
    `the ladder tally must be identical across ${RUNS} keys, saw ${[...ladderTallies]}`,
  ).toBe(1);
  expect([...ladderTallies][0]).toBe(`${RSA_WINDOW_BITS} squares · ${RSA_WINDOW_BITS} multiplies`);
  // And it must not be constant merely because nothing changed between runs:
  // the naive tally tracks the secret, so a fresh key should move it.
  expect(naiveTallies.size, 'the naive tally must respond to the secret').toBeGreaterThan(1);
});

test('panel 4 cache verdict is recomputed from the cached/uncached means it published', async ({ page }) => {
  await openPage(page);
  await settle(page, '#cache-run', '#cache-verdict');

  const rows = await tableRows(page, '#cache-table');
  const byLabel = new Map(rows.map((r) => [r[0], Number(r[1])]));
  const byLabelRaw = new Map(rows.map((r) => [r[0], (r[1] ?? '').trim()]));
  expect([...byLabel.keys()]).toEqual(['Cached', 'Uncached']);
  const cached = byLabel.get('Cached')!;
  const uncached = byLabel.get('Uncached')!;
  expect(cached).toBeGreaterThanOrEqual(0);
  expect(uncached).toBeGreaterThanOrEqual(0);

  const summary = await page.locator('#cache-summary').textContent();
  expect(Math.abs(num(summary, /cached mean=(-?[\d.]+) ms/u, 'cached mean') - cached)).toBeLessThan(EPS);
  expect(Math.abs(num(summary, /uncached mean=(-?[\d.]+) ms/u, 'uncached mean') - uncached)).toBeLessThan(EPS);

  const gap = Math.abs(uncached - cached) / Math.max(cached, uncached, 1e-9);
  const verdict = await page.locator('#cache-verdict').textContent();
  const tone = await page.locator('#cache-verdict').getAttribute('class');
  if (tone?.includes('verdict--leak')) {
    // "Cache state is observable" requires uncached to actually be SLOWER.
    expect(uncached, 'observable cache state requires uncached > cached').toBeGreaterThan(cached);
    const claimed = num(verdict, /~(-?[\d.]+)% slower/u, 'claimed slowdown');
    // The verdict is computed from full-precision means but printed to whole
    // percent, and the table rounds the means it shows. Compare inside the
    // error those two roundings actually allow, rather than a flat window that
    // is either too loose for large gaps or too tight for sub-millisecond ones.
    const cachedCell = byLabelRaw.get('Cached')!;
    const uncachedCell = byLabelRaw.get('Uncached')!;
    const propagated =
      ((halfUlp(uncachedCell) + gap * halfUlp(cachedCell)) / Math.max(cached, uncached, 1e-9)) * 100;
    expect(
      Math.abs(claimed - gap * 100),
      `verdict % matches the table (claimed ${claimed}, table ${(gap * 100).toFixed(3)}, allowed ${(0.5 + propagated).toFixed(3)})`,
    ).toBeLessThanOrEqual(0.5 + propagated + 1e-9);
    expect(claimed).toBeGreaterThanOrEqual(15 - EPS * 100);
  } else {
    expect(
      uncached <= cached || gap <= 0.15 + EPS,
      `inconclusive verdict but cached=${cached} uncached=${uncached}`
    ).toBe(true);
  }

  // The L1-DRAM ladder is documented as a FIXED reference diagram, not a
  // measurement. Running the benchmark must not rewrite it.
  expect(await page.locator('#l1-v').textContent()).toBe('~1 ns');
  expect(await page.locator('#dram-v').textContent()).toBe('~80 ns');
  await rerun(page, '#cache-run');
  expect(await page.locator('#l1-v').textContent()).toBe('~1 ns');
  expect(await page.locator('#dram-v').textContent()).toBe('~80 ns');
});

test('regression: a verdict never outlives the inputs it was measured from', async ({ page }) => {
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');

  const measured = await page.locator('#strcmp-verdict').textContent();
  expect(measured).toMatch(/Timing signal observed this run|Both paths drifted this run|Signal below noise/u);
  expect(await page.locator('#strcmp-table table').count()).toBe(1);

  // Editing the secret invalidates the run that produced the verdict above.
  await page.fill('#strcmp-target', 'a-completely-different-secret');
  const stale = page.locator('#strcmp-verdict');
  await expect(stale).toContainText('Inputs changed');
  // Assert against the text the panel actually rendered a moment ago, so this
  // stays a real check if the verdict wording changes again — matching a fixed
  // label would quietly pass the day that label stops being used.
  await expect(stale).not.toContainText(measured!.split('.')[0]!.replace(/^[⚠✓•]\s*/u, '').trim());
  await expect(page.locator('#strcmp-summary')).toBeEmpty();
  expect(await page.locator('#strcmp-table table').count(), 'stale data table cleared').toBe(0);

  // The control still works afterwards: re-running restores a real verdict.
  await rerun(page, '#strcmp-run');
  await expect(stale).toContainText(/Timing signal observed this run|Both paths drifted this run|Signal below noise/u);
  expect(await page.locator('#strcmp-table table').count()).toBe(1);

  // Same rule for the HMAC panel's message field.
  await settle(page, '#hmac-run', '#hmac-verdict');
  await page.fill('#hmac-message', 'POST /api/transfer?amount=999999');
  const hmacVerdict = page.locator('#hmac-verdict');
  await expect(hmacVerdict).toContainText('Inputs changed');
  await expect(page.locator('#hmac-summary')).toBeEmpty();
  await rerun(page, '#hmac-run');
  await expect(hmacVerdict).not.toContainText('Inputs changed');
  // ...and the new MAC really is the MAC of the NEW message.
  const newMac = await macHex(page, 'POST /api/transfer?amount=999999');
  await expect(page.locator('#hmac-summary')).toContainText(newMac.slice(0, 16));
});

test('regression: a verdict does not outlive inputs changed while the run is still in flight', async ({
  page,
}) => {
  await openPage(page);
  await settle(page, '#hmac-run', '#hmac-verdict');

  const OLD = 'transfer 100 to alice';
  const NEW = 'transfer 999999 to mallory';
  await page.fill('#hmac-message', OLD);
  await rerun(page, '#hmac-run');
  await expect(page.locator('#hmac-summary')).not.toBeEmpty();

  // Compute the reference MACs BEFORE arming the hook below — they go through
  // crypto.subtle.sign too, and would otherwise spend its one-shot trigger.
  const oldMac = await macHex(page, OLD);
  const newMac = await macHex(page, NEW);

  // benchmarkHmacVerification's only await is one WebCrypto round trip, well
  // under a millisecond, so the interleaving cannot be hit by wall-clock timing
  // from out here. Hold that real await open and edit the message from inside
  // it: the window is genuine, this only makes landing in it deterministic.
  await page.evaluate((next) => {
    const realSign = crypto.subtle.sign.bind(crypto.subtle);
    let armed = true;
    Object.defineProperty(crypto.subtle, 'sign', {
      configurable: true,
      value: async (...args: Parameters<typeof realSign>) => {
        const out = await realSign(...args);
        if (armed) {
          armed = false;
          await new Promise((resolve) => setTimeout(resolve, 250));
          const input = document.getElementById('hmac-message') as HTMLInputElement;
          input.value = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return out;
      },
    });
  }, NEW);

  await page.locator('#hmac-run').click();
  await expect(page.locator('#hmac-run')).toBeEnabled({ timeout: 90_000 });

  // The run that started against OLD must not publish now that the box says NEW.
  await expect(page.locator('#hmac-verdict')).toContainText('Inputs changed');
  await expect(page.locator('#hmac-summary')).toBeEmpty();
  expect(await page.locator('#hmac-table table').count(), 'stale table cleared').toBe(0);
  expect(await page.inputValue('#hmac-message')).toBe(NEW);

  // Give the retired run every chance to draw itself late.
  await page.waitForTimeout(400);
  const summary = await page.locator('#hmac-summary').innerText();
  expect(summary, 'the retired run must never render its MAC').not.toContain(oldMac.slice(0, 16));
  await expect(page.locator('#hmac-verdict')).toContainText('Inputs changed');

  // And the panel is still usable: a fresh run measures the message on screen.
  await rerun(page, '#hmac-run');
  await expect(page.locator('#hmac-summary')).toContainText(newMac.slice(0, 16));
});

test('regression: malformed MAC hex reaches the failure state and names the cause', async ({ page }) => {
  await openPage(page);
  await settle(page, '#hmac-run', '#hmac-verdict');

  await page.fill('#hmac-forged', 'nothex!!');
  await rerun(page, '#hmac-run');

  // The failure is surfaced, not silently replaced with an all-zero MAC.
  const error = page.locator('#hmac-error');
  await expect(error).toContainText('hex');
  await expect(page.locator('#hmac-verdict')).toContainText('Run failed');
  await expect(page.locator('#hmac-verdict')).toContainText('hex');
  await expect(page.locator('#hmac-summary')).toContainText('HMAC timing run failed');
  expect(await page.locator('#hmac-table table').count(), 'no data table for a failed run').toBe(0);

  // Odd-length hex is malformed too.
  await page.fill('#hmac-forged', 'abc');
  await rerun(page, '#hmac-run');
  await expect(error).toContainText('even length');

  // The panel recovers: a valid MAC measures again and clears the error.
  await page.fill('#hmac-forged', '00'.repeat(32));
  await rerun(page, '#hmac-run');
  await expect(error).toBeEmpty();
  await expect(page.locator('#hmac-verdict')).not.toContainText('Run failed');
  expect(await page.locator('#hmac-table table').count()).toBe(1);
});

test('an RSA benchmark failure is reported with its cause and leaves the control usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = crypto.subtle.generateKey.bind(crypto.subtle);
    // Fault-inject the WebCrypto step the RSA panel finishes with.
    crypto.subtle.generateKey = ((...args: unknown[]) => {
      void original;
      void args;
      return Promise.reject(new Error('injected WebCrypto keygen failure'));
    }) as typeof crypto.subtle.generateKey;
  });
  await openPage(page);
  await settle(page, '#rsa-run', '#rsa-verdict');

  const verdict = page.locator('#rsa-verdict');
  await expect(verdict).toContainText('RSA run failed');
  await expect(verdict, 'the failure names its cause').toContainText('injected WebCrypto keygen failure');
  await expect(page.locator('#rsa-summary')).toContainText('injected WebCrypto keygen failure');
  expect(await page.locator('#rsa-table table').count(), 'no data table for a failed run').toBe(0);

  // The button must not be left permanently dead after a failed run.
  await expect(page.locator('#rsa-run')).toBeEnabled();
  await rerun(page, '#rsa-run');
  await expect(verdict).toContainText('RSA run failed');
});

/** Pixel fingerprint of a canvas, so "the overlay was drawn" is checkable. */
async function canvasHash(page: Page, sel: string): Promise<string> {
  return page.locator(sel).evaluate((el) => (el as HTMLCanvasElement).toDataURL());
}

test('the modeled overlay is drawn, labelled as modeled, and changes no measurement', async ({
  page,
}) => {
  await openPage(page);
  // Quiesce the WHOLE page before capturing baselines. Panels finish at
  // staggered times now that benchmarks are serialized page-wide, and each one
  // that lands changes the document height; a scrollbar appearing or vanishing
  // fires the debounced resize redraw, which re-renders every canvas at a new
  // width. That would move the histogram's pixels for reasons that have nothing
  // to do with the overlay this test is about.
  for (const [button, verdict] of [
    ['#strcmp-run', '#strcmp-verdict'],
    ['#hmac-run', '#hmac-verdict'],
    ['#rsa-run', '#rsa-verdict'],
    ['#cache-run', '#cache-verdict'],
  ] as const) {
    await settle(page, button, verdict);
  }
  await page.locator('#strcmp-run').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // outlast the 150ms resize-redraw debounce

  const toggle = page.locator('#strcmp-modeled');
  await expect(toggle).not.toBeChecked();

  // The label and the hint both have to say it is not a measurement — this
  // overlay's whole licence to exist is that it is never mistaken for one.
  const label = await page.locator('label.mode-check').innerText();
  expect(label.replace(/\s+/u, ' ')).toContain('Show modeled ideal signal (not measured)');
  const hint = await page.locator('#strcmp-modeled-hint').innerText();
  expect(hint).toContain('Labeled');
  expect(hint).toContain('never mistaken for a measurement');

  // Everything the page reports as measured, before the overlay.
  const before = {
    chart: await canvasHash(page, '#strcmp-sweep'),
    hist: await canvasHash(page, '#strcmp-hist'),
    summary: await page.locator('#strcmp-summary').innerText(),
    verdict: await page.locator('#strcmp-verdict').innerText(),
    table: await tableRows(page, '#strcmp-table'),
  };
  expect(before.table.length).toBeGreaterThan(1);

  await toggle.check();
  await expect(toggle).toBeChecked();

  // The overlay really is drawn: the sweep chart's pixels change.
  const withOverlay = await canvasHash(page, '#strcmp-sweep');
  expect(withOverlay, 'toggling the overlay must redraw the sweep chart').not.toBe(before.chart);

  // And nothing measured moves. A modeled curve that edited the reported
  // numbers would be exactly the dishonesty the label disclaims.
  expect(await page.locator('#strcmp-summary').innerText()).toBe(before.summary);
  expect(await page.locator('#strcmp-verdict').innerText()).toBe(before.verdict);
  expect(await tableRows(page, '#strcmp-table')).toEqual(before.table);
  expect(await canvasHash(page, '#strcmp-hist')).toBe(before.hist);

  // Turning it back off restores the measured-only chart exactly.
  await toggle.uncheck();
  expect(await canvasHash(page, '#strcmp-sweep')).toBe(before.chart);
  expect(await page.locator('#strcmp-summary').innerText()).toBe(before.summary);
  expect(await tableRows(page, '#strcmp-table')).toEqual(before.table);
});

test('replaying a mechanism animation re-runs it without moving the counts it reports', async ({
  page,
}) => {
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');
  await settle(page, '#rsa-run', '#rsa-verdict');

  // The mechanism panels are deterministic functions of their inputs, so a
  // replay is an animation, never a re-measurement.
  for (const [root, play] of [
    ['#strcmp-mech', '#strcmp-mech-play'],
    ['#rsa-mech', '#rsa-mech-play'],
  ] as const) {
    const button = page.locator(play);
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();

    const before = (await page.locator(root).innerText()).replace(/\s+/gu, ' ').trim();
    expect(before.length, `${root} must render something to replay`).toBeGreaterThan(0);

    await button.click();
    // The replay steps through the loop, so wait for it to settle — and settle
    // it must, on exactly the state it started from.
    await expect
      .poll(
        async () => (await page.locator(root).innerText()).replace(/\s+/gu, ' ').trim(),
        { timeout: 30_000, message: `${root} changed its reported counts on a replay` },
      )
      .toBe(before);
    await expect(button).toBeEnabled({ timeout: 30_000 });
  }
});

test('only one panel is ever being timed at once', async ({ page }) => {
  // Regression: withRunning() guarded only its own button, and the lazy
  // IntersectionObserver schedules one run per panel that scrolls into view.
  // With the whole page in view, three panels (strcmp, hmac, rsa) were observed
  // in the Running state at the same instant — while each verdict said
  // "Measured over N samples in this browser on this machine", a condition that
  // did not hold. The RSA panel times WebCrypto signs around an await, so a
  // neighbouring synchronous benchmark lands inside a measured span.
  //
  // A page-wide queue now serialises them. aria-busy marks only the panel whose
  // turn it is, so the invariant is directly observable.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 4000 }); // every panel in view at once
  await page.goto('.');
  await expect(page.locator('#main-content')).toBeVisible();

  const ids = ['strcmp-run', 'hmac-run', 'rsa-run', 'cache-run'];
  let samples = 0;
  let sawBusy = 0;
  let maxConcurrent = 0;

  // Poll for a fixed span with no early exit, so the sample count cannot
  // collapse to a handful and make the concurrency assertion vacuous.
  for (let i = 0; i < 120; i += 1) {
    const busy = await page.evaluate(
      (list) =>
        list.filter((id) => document.getElementById(id)?.getAttribute('aria-busy') === 'true')
          .length,
      ids,
    );
    samples += 1;
    if (busy > 0) sawBusy += 1;
    maxConcurrent = Math.max(maxConcurrent, busy);
    await page.waitForTimeout(10);
  }

  // Non-vacuous: the poll must actually have caught panels mid-measurement.
  expect(samples, 'the poll must have run').toBe(120);
  expect(sawBusy, 'at least one panel must have been caught measuring').toBeGreaterThan(0);
  expect(
    maxConcurrent,
    `${maxConcurrent} panels were being timed at once — each one reports "measured on this machine"`,
  ).toBe(1);

  // And every panel still finished: serialising must not strand one.
  for (const id of ids) {
    await expect(page.locator(`#${id}`)).toBeEnabled({ timeout: 90_000 });
  }
  const verdicts = await page.locator('.verdict').evaluateAll(
    (nodes) => nodes.filter((n) => (n.textContent ?? '').trim().length > 0).length,
  );
  expect(verdicts, 'all four panels must reach a verdict').toBe(ids.length);
});
