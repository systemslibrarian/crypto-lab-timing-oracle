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

/** 4-decimal rendering plus float noise; never wide enough to hide a sign flip. */
const EPS = 0.01;

test('panel 1 mechanism counts the exact bytes the compare loop inspects', async ({ page }) => {
  await openPage(page);
  await settle(page, '#strcmp-run', '#strcmp-verdict');

  // 8-char secret, first 4 bytes guessed right: the vulnerable loop must inspect
  // exactly 5 bytes (4 matches + the byte that fails) and skip the other 3.
  await page.fill('#strcmp-target', 'abcdefgh');
  await page.fill('#strcmp-guess', 'abcdWXYZ');

  const cells = await page
    .locator('#strcmp-mech [data-role=guess-row] .mech-cell')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.mark ?? ''));

  const matched = cells.filter((m) => m === '✓').length;
  const mismatched = cells.filter((m) => m === '✗').length;
  const skipped = cells.filter((m) => m === '–').length;

  expect(cells.length, 'one cell per secret byte').toBe(8);
  expect(matched).toBe(4);
  expect(mismatched).toBe(1);
  // Parts sum to the whole: every byte is accounted for exactly once.
  expect(matched + mismatched + skipped, 'cells accounted for').toBe(cells.length);
  expect(skipped).toBe(3);

  const vuln = await page.locator('#strcmp-mech [data-role=vuln-count]').textContent();
  const constant = await page.locator('#strcmp-mech [data-role=ct-count]').textContent();
  // The counter must equal the cells actually inspected, not a separate tally.
  expect(Number(vuln), 'vulnerable byte checks = inspected cells').toBe(matched + mismatched);
  // The defense: the constant-time count is the full length regardless of input.
  expect(Number(constant), 'constant-time byte checks = full length').toBe(cells.length);

  const status = await page.locator('#strcmp-mech [data-role=mech-status]').textContent();
  expect(status).toContain(`bailed out at byte ${matched + mismatched} of ${cells.length}`);
  expect(status).toContain(`only ${matched + mismatched} byte checks ran`);
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
    // "Leak detected" is only honest if the measured runtime actually ROSE and
    // cleared the panel's own 15% threshold.
    expect(gain, 'leak verdict requires a positive gain').toBeGreaterThan(0);
    expect(pct).toBeGreaterThanOrEqual(15 - EPS * 100);
  } else {
    const pct = num(verdict, /effect was ~(-?[\d.]+)%/u, 'verdict percentage');
    expect(
      gain <= 0 || pct <= 15 + EPS * 100,
      `inconclusive verdict but gain=${gain} pct=${pct}`
    ).toBe(true);
  }

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

test('panel 4 cache verdict is recomputed from the cached/uncached means it published', async ({ page }) => {
  await openPage(page);
  await settle(page, '#cache-run', '#cache-verdict');

  const rows = await tableRows(page, '#cache-table');
  const byLabel = new Map(rows.map((r) => [r[0], Number(r[1])]));
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
    expect(Math.abs(claimed - gap * 100), 'verdict % matches the table').toBeLessThan(1.5);
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
  expect(measured).toMatch(/Leak detected|Signal below noise/u);
  expect(await page.locator('#strcmp-table table').count()).toBe(1);

  // Editing the secret invalidates the run that produced the verdict above.
  await page.fill('#strcmp-target', 'a-completely-different-secret');
  const stale = page.locator('#strcmp-verdict');
  await expect(stale).toContainText('Inputs changed');
  await expect(stale).not.toContainText('Leak detected');
  await expect(page.locator('#strcmp-summary')).toBeEmpty();
  expect(await page.locator('#strcmp-table table').count(), 'stale data table cleared').toBe(0);

  // The control still works afterwards: re-running restores a real verdict.
  await rerun(page, '#strcmp-run');
  await expect(stale).toContainText(/Leak detected|Signal below noise/u);
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
  const newMac = await page.evaluate(async () => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('crypto-lab-timing-oracle-demo-key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, enc.encode('POST /api/transfer?amount=999999'))
    );
    return Array.from(mac)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  });
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
