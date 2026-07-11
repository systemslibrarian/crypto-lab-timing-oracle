import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the vitest suite; this
 * gates them on accessibility the same way. Scans the full page with every
 * <details> expanded and every live demo run, in both themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const RUN_BUTTONS = ['#strcmp-run', '#hmac-run', '#rsa-run', '#cache-run'];

async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation:none!important;transition:none!important;
      scroll-behavior:auto!important;
    }`,
  });
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of Array.from(document.querySelectorAll('details'))) {
      details.open = true;
    }
  });
}

/**
 * Drive every panel's benchmark so the dynamically-populated result regions
 * (verdicts, summaries, tables) are present when axe scans, then wait for each
 * run button to leave its "Running…" busy state.
 */
async function runAllDemos(page: Page): Promise<void> {
  for (const sel of RUN_BUTTONS) {
    const button = page.locator(sel);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(button).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
    await expect(button).toBeEnabled({ timeout: 30_000 });
  }
}

async function prepare(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#main-content')).toBeVisible();
  await killMotion(page);
  await runAllDemos(page);
  await openAllDetails(page);
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await prepare(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await prepare(page);
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openAllDetails(page);
  await scan(page);
});
