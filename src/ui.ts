import { benchmarkCacheTiming, type CacheTimingStats } from "./cache";
import { benchmarkHmacVerification, type HmacTimingStats } from "./hmac";
import { benchmarkRsaTiming, type RsaTimingStats } from "./rsa";
import { renderDataTable, renderHistogram, renderLineChart } from "./stats";
import { benchmarkStringComparisons, type ComparisonStats } from "./strcmp";
import { cacheVerdict, hmacVerdict, rsaVerdict, stringComparisonVerdict, type Verdict } from "./verdict";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required element: ${id}`);
  }
  return node as T;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const redraws: Array<() => void> = [];

function setTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  const button = byId<HTMLButtonElement>("theme-toggle");
  const isDark = theme === "dark";
  button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  button.textContent = isDark ? "🌙" : "☀️";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", isDark ? "#1e232b" : "#f5efe5");
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Disable the trigger, show a Running… state, paint it, then run the work. */
async function withRunning(button: HTMLButtonElement, work: () => void | Promise<void>): Promise<void> {
  if (button.dataset.running === "true") {
    return;
  }
  const label = button.dataset.label ?? button.textContent ?? "Run";
  button.dataset.label = label;
  button.dataset.running = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Running…";
  await nextFrame(); // let the Running… state paint before the synchronous benchmark
  try {
    await work();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.dataset.running = "false";
    button.textContent = label;
  }
}

function setVerdict(id: string, verdict: Verdict): void {
  const node = byId<HTMLDivElement>(id);
  node.className = `verdict verdict--${verdict.tone}`;
  const icon = verdict.tone === "leak" ? "⚠" : verdict.tone === "safe" ? "✓" : "•";
  node.innerHTML = `<strong>${icon} ${verdict.label}.</strong> ${verdict.detail}`;
}

function renderAppShell(): void {
  const app = byId<HTMLDivElement>("app");
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="hero" aria-label="Demo header">
      <div class="category-chip">Side-Channel Attacks</div>
      <h1>Timing Oracle</h1>
      <p class="subtitle">Browser-native timing side-channel lab: vulnerable vs constant-time implementations with real measurements.</p>
      <div class="chip-row">
        <span class="primitive-chip">Timing Attack</span>
        <span class="primitive-chip">Constant-Time</span>
        <span class="primitive-chip">HMAC</span>
        <span class="primitive-chip">RSA</span>
        <span class="primitive-chip">Cache-Timing</span>
      </div>
      <button id="theme-toggle" class="theme-toggle" aria-label="Switch to light mode" type="button">🌙</button>
    </header>

    <main id="main-content" aria-label="Timing oracle demo panels">
      <section class="why" aria-labelledby="why-title">
        <h2 id="why-title">Why this matters</h2>
        <p>
          Correct algorithm choice is not enough: implementation timing leaks have broken RSA, AES, HMAC, and TLS in production systems.
          Constant-time programming is non-negotiable in cryptographic code. Each panel below runs the vulnerable and hardened code in
          <em>your</em> browser and reports whether a timing signal is measurable right now.
        </p>
      </section>

      <section class="panel" aria-labelledby="panel1-title">
        <div class="panel-head">
          <h2 id="panel1-title">Panel 1 — String Comparison Timing Attack</h2>
          <div class="status-row">
            <span class="status bad">Vulnerable: AVOID</span>
            <span class="status good">Constant-Time: REQUIRED</span>
          </div>
        </div>
        <p class="panel-text">Naive string comparison exits on the first mismatch. Timing rises with longer correct prefixes and leaks secret bytes.</p>
        <div class="controls two-col">
          <label for="strcmp-target">Target secret string</label>
          <input id="strcmp-target" aria-label="Target secret string input" value="timing-oracle-demo-secret" />
          <label for="strcmp-guess">Attacker guess string</label>
          <input id="strcmp-guess" aria-label="Attacker guess string input" value="timing-oracle-demo-xxxxx" />
          <button id="strcmp-run" type="button">Run 10,000 iterations per mode</button>
        </div>
        <canvas id="strcmp-hist" aria-label="Histogram comparing vulnerable and constant-time string comparison timings" role="img"></canvas>
        <p id="strcmp-summary" class="chart-summary" aria-live="polite"></p>
        <div id="strcmp-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data"><summary>Show measured data</summary><div id="strcmp-table"></div></details>
      </section>

      <section class="panel" aria-labelledby="panel2-title">
        <div class="panel-head">
          <h2 id="panel2-title">Panel 2 — HMAC Verification Timing Leak</h2>
          <span class="status warn">Always use constant-time MAC verification</span>
        </div>
        <p class="panel-text">When MAC bytes are compared with early exit, response time reveals how many prefix bytes are correct.</p>
        <div class="controls two-col">
          <label for="hmac-message">Message</label>
          <input id="hmac-message" aria-label="Message for HMAC verification" value="POST /api/transfer?amount=1000" />
          <label for="hmac-forged">Forged MAC hex</label>
          <input id="hmac-forged" aria-label="Forged HMAC in hexadecimal" value="0000000000000000000000000000000000000000000000000000000000000000" />
          <button id="hmac-run" type="button">Measure MAC prefix timing</button>
        </div>
        <div id="hmac-error" class="error" role="status" aria-live="assertive"></div>
        <canvas id="hmac-line" aria-label="Line chart of HMAC timing by correct prefix length" role="img"></canvas>
        <p id="hmac-summary" class="chart-summary" aria-live="polite"></p>
        <div id="hmac-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data"><summary>Show measured data</summary><div id="hmac-table"></div></details>
        <p class="panel-note">Reference: Django timing attack CVEs and the history of constant-time comparison APIs such as Python <code>hmac.compare_digest</code>.</p>
      </section>

      <section class="panel" aria-labelledby="panel3-title">
        <div class="panel-head">
          <h2 id="panel3-title">Panel 3 — RSA Private Key Bit Leakage</h2>
          <span class="status warn">Always use constant-time exponentiation</span>
        </div>
        <p class="panel-text">Square-and-multiply uses a secret-dependent branch on each exponent bit. Montgomery ladder keeps operation count uniform.</p>
        <button id="rsa-run" type="button">Generate toy RSA key and measure bit leakage</button>
        <canvas id="rsa-hist" aria-label="Histogram of RSA timing under different private key bit patterns" role="img"></canvas>
        <p id="rsa-summary" class="chart-summary" aria-live="polite"></p>
        <div id="rsa-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data"><summary>Show measured data</summary><div id="rsa-table"></div></details>
        <p class="panel-note">Kocher, 1996: <em>Timing Attacks on Implementations of Diffie-Hellman, RSA, DSS, and Other Systems</em>.</p>
      </section>

      <section class="panel" aria-labelledby="panel4-title">
        <div class="panel-head">
          <h2 id="panel4-title">Panel 4 — Cache-Timing Attack</h2>
          <div class="status-row">
            <span class="status good">AES via WebCrypto: safer path</span>
            <span class="status bad">Pure-JS AES tables: vulnerable</span>
          </div>
        </div>
        <p class="panel-text">Cache hits and misses have different access latency. Secret-dependent table lookups can leak information via timing.</p>
        <button id="cache-run" type="button">Measure cached vs uncached memory access</button>
        <canvas id="cache-hist" aria-label="Histogram of cached and uncached memory access timings" role="img"></canvas>
        <div class="cache-grid" aria-label="Cache hierarchy timing diagram" role="img">
          <div><strong>L1</strong><span id="l1-v">~1 ns</span></div>
          <div><strong>L2</strong><span id="l2-v">~4 ns</span></div>
          <div><strong>L3</strong><span id="l3-v">~12 ns</span></div>
          <div><strong>DRAM</strong><span id="dram-v">~80 ns</span></div>
        </div>
        <p id="cache-summary" class="chart-summary" aria-live="polite"></p>
        <div id="cache-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data"><summary>Show measured data</summary><div id="cache-table"></div></details>
        <p class="panel-note">Bernstein, 2005: cache-timing attacks on AES table lookups; AES-NI avoids lookup-table leakage.</p>
      </section>

      <section class="panel" aria-labelledby="panel5-title">
        <h2 id="panel5-title">Panel 5 — Defense Patterns and Real-World Impact</h2>
        <ol class="rules" aria-label="Constant-time defense checklist">
          <li>No secret-dependent branches.</li>
          <li>No secret-dependent memory accesses.</li>
          <li>No secret-dependent loop counts.</li>
          <li>Always use constant-time comparison for MACs and passwords.</li>
          <li>Use hardware crypto (AES-NI, WebCrypto) over software table implementations.</li>
        </ol>
        <ul class="hall" aria-label="Timing attack hall of fame">
          <li>Kocher 1996 — RSA and Diffie-Hellman timing leakage.</li>
          <li>Bernstein 2005 — AES cache timing.</li>
          <li>Lucky Thirteen 2013 — TLS CBC timing.</li>
          <li>Multiple HMAC timing CVEs in web frameworks.</li>
        </ul>
        <p class="panel-note">Browser timers are intentionally coarser after Spectre mitigations. That reduces resolution, but repeated samples and statistical analysis can still reveal real leakage patterns.</p>
        <nav class="links" aria-label="Related demos and other crypto-lab projects">
          <a href="https://github.com/systemslibrarian/crypto-lab-aes-modes" target="_blank" rel="noreferrer">crypto-lab-aes-modes</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-mac-race" target="_blank" rel="noreferrer">crypto-lab-mac-race</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-rsa-forge" target="_blank" rel="noreferrer">crypto-lab-rsa-forge</a>
          <a href="https://github.com/systemslibrarian/crypto-compare" target="_blank" rel="noreferrer">crypto-compare (Symmetric + MAC)</a>
          <a href="https://github.com/systemslibrarian/crypto-lab" target="_blank" rel="noreferrer">crypto-lab landing page</a>
        </nav>
      </section>
    </main>
  `;
}

function wireThemeToggle(): void {
  const saved = localStorage.getItem("theme");
  const current = saved === "light" || saved === "dark" ? saved : "dark";
  setTheme(current);

  const toggle = byId<HTMLButtonElement>("theme-toggle");
  toggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    for (const redraw of redraws) {
      redraw();
    }
  });
}

const VULN = "#ce2f4f";
const SAFE = "#1f7a48";

function wireStringPanel(): () => Promise<void> {
  const run = byId<HTMLButtonElement>("strcmp-run");
  const targetInput = byId<HTMLInputElement>("strcmp-target");
  const guessInput = byId<HTMLInputElement>("strcmp-guess");
  const canvas = byId<HTMLCanvasElement>("strcmp-hist");
  const summary = byId<HTMLParagraphElement>("strcmp-summary");
  const table = byId<HTMLDivElement>("strcmp-table");

  let stats: ComparisonStats | null = null;

  function draw(): void {
    if (!stats) {
      return;
    }
    renderHistogram(
      canvas,
      [
        { label: "Vulnerable", values: stats.vulnerableSamples, color: VULN },
        { label: "Constant-Time", values: stats.constantSamples, color: SAFE }
      ],
      "String comparison timing distribution"
    );
    summary.textContent =
      `Prefix match length: ${stats.prefixMatchLength} chars. ` +
      `Vulnerable mean ${stats.vulnerableMean.toFixed(4)} ms (sigma ${stats.vulnerableStdDev.toFixed(4)}); ` +
      `constant-time mean ${stats.constantMean.toFixed(4)} ms (sigma ${stats.constantStdDev.toFixed(4)}). ` +
      `${stats.iterationsPerMode.toLocaleString()} real comparisons per mode via performance.now().`;
    setVerdict("strcmp-verdict", stringComparisonVerdict(stats.vulnerableShortPrefixMs, stats.vulnerableLongPrefixMs));
    renderDataTable(
      table,
      "Vulnerable vs constant-time batch time by number of correct leading characters",
      ["Correct chars", "Vulnerable (ms)", "Constant-time (ms)"],
      stats.sweep.map((point) => [point.matchedPrefix, point.vulnerableMean, point.constantMean])
    );
  }
  redraws.push(draw);

  async function execute(): Promise<void> {
    stats = benchmarkStringComparisons(targetInput.value, guessInput.value, 10000);
    draw();
  }

  run.addEventListener("click", () => void withRunning(run, execute));
  return execute;
}

function wireHmacPanel(): () => Promise<void> {
  const run = byId<HTMLButtonElement>("hmac-run");
  const messageInput = byId<HTMLInputElement>("hmac-message");
  const forgedInput = byId<HTMLInputElement>("hmac-forged");
  const error = byId<HTMLDivElement>("hmac-error");
  const canvas = byId<HTMLCanvasElement>("hmac-line");
  const summary = byId<HTMLParagraphElement>("hmac-summary");
  const table = byId<HTMLDivElement>("hmac-table");

  let stats: HmacTimingStats | null = null;

  function draw(): void {
    if (!stats) {
      return;
    }
    renderLineChart(
      canvas,
      [
        { label: "Vulnerable", points: stats.points.map((p) => ({ x: p.prefixBytes, y: p.vulnerableMean })), color: VULN },
        { label: "Constant-Time", points: stats.points.map((p) => ({ x: p.prefixBytes, y: p.constantMean })), color: SAFE }
      ],
      "HMAC verification time by matching prefix bytes"
    );

    const vulnerableSlope = stats.points[stats.points.length - 1].vulnerableMean - stats.points[0].vulnerableMean;
    const constantSlope = stats.points[stats.points.length - 1].constantMean - stats.points[0].constantMean;
    summary.textContent =
      `Expected MAC (first 16 hex): ${stats.expectedMacHex.slice(0, 16)}… ` +
      `Single-check vulnerable=${stats.vulnerableUserCheckMs.toFixed(6)} ms, constant-time=${stats.constantUserCheckMs.toFixed(6)} ms. ` +
      `Prefix slope vulnerable=${vulnerableSlope.toFixed(4)} ms, constant-time=${constantSlope.toFixed(4)} ms.`;
    setVerdict("hmac-verdict", hmacVerdict(vulnerableSlope, constantSlope, stats.points[0].vulnerableMean));
    renderDataTable(
      table,
      "Mean verification time by number of correct MAC prefix bytes",
      ["Correct bytes", "Vulnerable (ms)", "Constant-time (ms)"],
      stats.points.map((p) => [p.prefixBytes, p.vulnerableMean, p.constantMean])
    );
  }
  redraws.push(draw);

  async function execute(): Promise<void> {
    error.textContent = "";
    try {
      stats = await benchmarkHmacVerification(messageInput.value, forgedInput.value, 8000);
      draw();
    } catch (caught) {
      stats = null;
      error.textContent = caught instanceof Error ? caught.message : "HMAC benchmark failed.";
      summary.textContent = "HMAC timing run failed; adjust forged MAC hex and retry.";
    }
  }

  run.addEventListener("click", () => void withRunning(run, execute));
  return execute;
}

function wireRsaPanel(): () => Promise<void> {
  const run = byId<HTMLButtonElement>("rsa-run");
  const canvas = byId<HTMLCanvasElement>("rsa-hist");
  const summary = byId<HTMLParagraphElement>("rsa-summary");
  const table = byId<HTMLDivElement>("rsa-table");

  let stats: RsaTimingStats | null = null;

  function draw(): void {
    if (!stats) {
      return;
    }
    renderHistogram(
      canvas,
      [
        { label: "Naive bit=0", values: stats.naiveBit0Samples, color: "#d77a0a" },
        { label: "Naive bit=1", values: stats.naiveBit1Samples, color: VULN },
        { label: "Ladder bit=0", values: stats.ladderBit0Samples, color: "#195d9a" },
        { label: "Ladder bit=1", values: stats.ladderBit1Samples, color: SAFE }
      ],
      "RSA exponentiation timing distributions"
    );

    const naiveGap = Math.abs(stats.naiveBit1Mean - stats.naiveBit0Mean);
    const ladderGap = Math.abs(stats.ladderBit1Mean - stats.ladderBit0Mean);
    summary.textContent =
      `${stats.keyDescription}. Flipped private exponent bit index ${stats.selectedBitIndex}. ` +
      `Naive gap=${naiveGap.toFixed(4)} ms, ladder gap=${ladderGap.toFixed(4)} ms over repeated measurements. ` +
      `WebCrypto RSA-PSS sign mean=${stats.webCryptoSignMeanMs.toFixed(4)} ms.`;
    setVerdict("rsa-verdict", rsaVerdict(naiveGap, ladderGap, stats.naiveBit0Mean));
    renderDataTable(
      table,
      "Mean exponentiation time by method and secret bit value",
      ["Series", "Mean (ms)"],
      [
        ["Naive bit=0", stats.naiveBit0Mean],
        ["Naive bit=1", stats.naiveBit1Mean],
        ["Ladder bit=0", stats.ladderBit0Mean],
        ["Ladder bit=1", stats.ladderBit1Mean],
        ["WebCrypto RSA-PSS sign", stats.webCryptoSignMeanMs]
      ]
    );
  }
  redraws.push(draw);

  async function execute(): Promise<void> {
    try {
      stats = await benchmarkRsaTiming(140);
      draw();
    } catch (caught) {
      stats = null;
      summary.textContent = caught instanceof Error ? caught.message : "RSA benchmark failed.";
      setVerdict("rsa-verdict", {
        tone: "inconclusive",
        label: "RSA run failed",
        detail: "Could not generate a toy key this run. Press the button to try again."
      });
    }
  }

  run.addEventListener("click", () => void withRunning(run, execute));
  return execute;
}

function wireCachePanel(): () => Promise<void> {
  const run = byId<HTMLButtonElement>("cache-run");
  const canvas = byId<HTMLCanvasElement>("cache-hist");
  const summary = byId<HTMLParagraphElement>("cache-summary");
  const table = byId<HTMLDivElement>("cache-table");

  let stats: CacheTimingStats | null = null;

  function draw(): void {
    if (!stats) {
      return;
    }
    renderHistogram(
      canvas,
      [
        { label: "Cached", values: stats.cachedSamples, color: SAFE },
        { label: "Uncached", values: stats.uncachedSamples, color: VULN }
      ],
      "Cached vs uncached access timing"
    );
    byId<HTMLSpanElement>("l1-v").textContent = `~${stats.l1EstimateNs} ns`;
    byId<HTMLSpanElement>("l2-v").textContent = `~${stats.l2EstimateNs} ns`;
    byId<HTMLSpanElement>("l3-v").textContent = `~${stats.l3EstimateNs} ns`;
    byId<HTMLSpanElement>("dram-v").textContent = `~${stats.dramEstimateNs} ns`;
    summary.textContent =
      `Measured cached mean=${stats.cachedMean.toFixed(4)} ms, uncached mean=${stats.uncachedMean.toFixed(4)} ms. ` +
      `Timing differs because cache-line residency changes memory latency. WebCrypto AES routes to hardened native implementations.`;
    setVerdict("cache-verdict", cacheVerdict(stats.cachedMean, stats.uncachedMean));
    renderDataTable(
      table,
      "Mean access time for cache-resident vs evicted working set",
      ["Access", "Mean (ms)"],
      [
        ["Cached", stats.cachedMean],
        ["Uncached", stats.uncachedMean]
      ]
    );
  }
  redraws.push(draw);

  async function execute(): Promise<void> {
    stats = benchmarkCacheTiming(180);
    draw();
  }

  run.addEventListener("click", () => void withRunning(run, execute));
  return execute;
}

function wireResizeRedraw(): void {
  let timer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      for (const redraw of redraws) {
        redraw();
      }
    }, 150);
  });
}

export function initUi(): void {
  renderAppShell();
  wireThemeToggle();
  const runString = wireStringPanel();
  const runHmac = wireHmacPanel();
  const runRsa = wireRsaPanel();
  const runCache = wireCachePanel();
  wireResizeRedraw();

  byId<HTMLParagraphElement>("cache-summary").textContent = prefersReducedMotion()
    ? "Reduced-motion mode detected: chart redraw animations are disabled."
    : "Running benchmarks…";

  // Run panels sequentially after first paint so the page stays responsive.
  // Each panel is isolated so a failure in one cannot block the others.
  void (async () => {
    const panels: Array<[string, () => Promise<void>]> = [
      ["strcmp-run", runString],
      ["hmac-run", runHmac],
      ["rsa-run", runRsa],
      ["cache-run", runCache]
    ];
    for (const [id, run] of panels) {
      try {
        await withRunning(byId<HTMLButtonElement>(id), run);
      } catch {
        /* a single panel failing must not stop the rest from initializing */
      }
    }
  })();
}
