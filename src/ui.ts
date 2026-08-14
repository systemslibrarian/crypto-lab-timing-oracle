import { createCompareAnimator, createExponentAnimator } from "./animate";
import { benchmarkCacheTiming, type CacheTimingStats } from "./cache";
import { benchmarkHmacVerification, type HmacTimingStats } from "./hmac";
import { modeledPrefixCost } from "./mechanism";
import { benchmarkRsaTiming, EXPONENT_WINDOW_BITS, type RsaTimingStats } from "./rsa";
import { renderDataTable, renderHistogram, renderLineChart, type LineSeries } from "./stats";
import { benchmarkStringComparisons, type ComparisonStats } from "./strcmp";
import { cacheVerdict, hmacVerdict, rsaVerdict, stringComparisonVerdict, type Verdict } from "./verdict";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required element: ${id}`);
  }
  return node as T;
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

/** Run `fn` during browser idle time, falling back to a macrotask. */
function scheduleIdle(fn: () => void): void {
  const idle: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
  if (typeof idle === "function") {
    idle(() => fn(), { timeout: 2000 });
  } else {
    window.setTimeout(fn, 0);
  }
}

/**
 * Run `fn` once, the first time `target` scrolls into view, scheduled during
 * idle time. Keeps the heavy benchmarks off the initial-load critical path so
 * the page stays fast and responsive on mobile.
 */
function runWhenVisible(target: Element, fn: () => void): void {
  if (typeof IntersectionObserver === "undefined") {
    scheduleIdle(fn);
    return;
  }
  const observer = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          obs.disconnect();
          scheduleIdle(fn);
        }
      }
    },
    { rootMargin: "0px" }
  );
  observer.observe(target);
}

/**
 * Page-wide benchmark queue: exactly one panel measures at a time.
 *
 * Every panel reports "Measured over N samples in this browser on this machine",
 * so the condition it names has to actually hold. It did not. `withRunning()`
 * guarded only its OWN button, while the lazy IntersectionObserver fires one
 * scheduleIdle() per panel that scrolls into view — and the RSA panel awaits
 * WebCrypto RSA-PSS keygen plus 24 awaited signs, each timed with
 * performance.now() around the await, so another panel's synchronous benchmark
 * can land inside a measured span. Driven headless with the whole page in view,
 * three panels (strcmp, hmac, rsa) were observed in the Running state at the
 * same instant.
 *
 * Concurrency on one main thread changes JIT state, GC pressure and event-loop
 * scheduling — the very distributions being measured — so a lab about timing
 * cannot let its own panels race each other.
 */
let benchmarkQueue: Promise<unknown> = Promise.resolve();

function serializeBenchmark<T>(work: () => Promise<T>): Promise<T> {
  // `then(work, work)` so one failed benchmark does not wedge the queue.
  const result = benchmarkQueue.then(work, work);
  benchmarkQueue = result.catch(() => undefined);
  return result;
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
  // Queued is not measuring: aria-busy and the Running… label are claimed only
  // on this panel's turn, so "busy" always means "this is the panel being timed".
  button.textContent = "Queued…";
  try {
    await serializeBenchmark(async () => {
      button.setAttribute("aria-busy", "true");
      button.textContent = "Running…";
      await nextFrame(); // let the Running… state paint before the synchronous benchmark
      await work();
    });
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

/**
 * A verdict describes ONE measurement of ONE set of inputs. When the user edits
 * the inputs afterwards, the rendered verdict, summary, chart and table all
 * describe a run that no longer exists — a "Leak detected ⚠" panel sitting above
 * a secret it was never measured against. Every panel with editable controls
 * therefore invalidates its own output on input, replacing it with this.
 */
const STALE_VERDICT: Verdict = {
  tone: "inconclusive",
  label: "Inputs changed — not measured yet",
  detail: "These controls changed after the last run, so the previous result no longer describes them. Press the run button to measure the current inputs."
};

/** Blank a chart so a stale plot cannot outlive the inputs it was drawn from. */
function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function renderAppShell(): void {
  const app = byId<HTMLDivElement>("app");
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="cl-hero">
      <div class="cl-hero-main">
        <h1 class="cl-hero-title">Timing Oracle</h1>
        <p class="cl-hero-sub">Timing side-channels · Constant-time defenses</p>
        <p class="cl-hero-desc">Runs vulnerable vs constant-time string comparison, HMAC verification, RSA exponentiation, and cache access in your browser and measures whether a secret-dependent timing signal is detectable.</p>
      </div>
      <aside class="cl-hero-why" aria-label="Why it matters">
        <span class="cl-hero-why-label">WHY IT MATTERS</span>
        <p class="cl-hero-why-text">Choosing the right algorithm is not enough: timing leaks have broken RSA, AES, HMAC, and TLS in shipped systems. When execution time depends on secret data, an attacker who measures it can recover keys and MACs, which is why constant-time code is mandatory in crypto.</p>
      </aside>
      <button id="theme-toggle" class="theme-toggle" aria-label="Switch to light mode" type="button">🌙</button>
    </header>

    <main id="main-content" aria-label="Timing oracle demo panels">
      <section class="panel" aria-labelledby="panel1-title">
        <div class="panel-head">
          <h2 id="panel1-title">Panel 1 — String Comparison Timing Attack</h2>
          <div class="status-row">
            <span class="status bad">Vulnerable: AVOID</span>
            <span class="status good">Constant-Time: REQUIRED</span>
          </div>
        </div>
        <p class="panel-text">Naive string comparison exits on the first mismatch. Timing rises with longer correct prefixes and leaks the secret one character at a time.</p>
        <div class="controls two-col">
          <label for="strcmp-target">Target secret string</label>
          <input id="strcmp-target" aria-label="Target secret string input" value="timing-oracle-demo-secret" />
          <label for="strcmp-guess">Attacker guess string</label>
          <input id="strcmp-guess" aria-label="Attacker guess string input" value="timing-oracle-demo-xxxxx" />
          <button id="strcmp-run" type="button">Run 10,000 iterations per mode</button>
        </div>

        <div class="mechanism" id="strcmp-mech" aria-labelledby="strcmp-mech-title">
          <div class="mechanism-head">
            <h3 id="strcmp-mech-title" class="mechanism-title">The mechanism, step by step</h3>
            <button id="strcmp-mech-play" class="mech-play" type="button" aria-label="Replay the compare-loop animation">▶ Replay</button>
          </div>
          <p class="mechanism-lead">This runs the compare loop for real on your current guess and counts character checks — no timer, so it is exact every run. The comparator walks UTF-16 code units, which is what &ldquo;character&rdquo; counts here; for accented letters or emoji that is not the same as UTF-8 bytes. Watch the vulnerable loop stop at the first mismatch — and try a guess of the wrong length.</p>
          <div class="mech-grid" tabindex="0" role="region" aria-label="Character-by-character comparison of secret and guess">
            <div class="mech-row" data-role="target-row"></div>
            <div class="mech-row" data-role="guess-row"></div>
          </div>
          <div class="mech-counters" aria-live="polite">
            <span class="mech-counter mech-counter--vuln">Vulnerable character checks: <strong data-role="vuln-count">0</strong></span>
            <span class="mech-counter mech-counter--ct">Constant-time character checks: <strong data-role="ct-count">0</strong></span>
          </div>
          <p class="mech-status" data-role="mech-status" aria-live="polite"></p>
          <p class="mech-legend"><span class="mech-key mech-key--match">✓ matched</span> <span class="mech-key mech-key--mismatch">✗ first mismatch (loop exits)</span> <span class="mech-key mech-key--skipped">– never inspected</span></p>
        </div>

        <figure class="chart-figure">
          <figcaption id="strcmp-cap" class="chart-caption">What you are looking at: time vs. how many leading characters the guess got right. A line that <strong>rises to the right</strong> = each correct character costs more = leak. A <strong>flat line</strong> = constant-time = safe.</figcaption>
          <canvas id="strcmp-sweep" aria-label="Line chart of vulnerable and constant-time comparison time versus number of correct leading characters" role="img" aria-describedby="strcmp-cap"></canvas>
        </figure>
        <div class="mode-toggle">
          <label class="mode-check"><input type="checkbox" id="strcmp-modeled" /> <span>Show modeled ideal signal (not measured)</span></label>
          <span class="mode-hint" id="strcmp-modeled-hint">If your browser's coarse timer hides the leak, this overlays the ideal shape — work proportional to prefix length. Labeled <em>modeled</em>, never mistaken for a measurement.</span>
        </div>
        <p id="strcmp-summary" class="chart-summary" aria-live="polite"></p>
        <div id="strcmp-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data">
          <summary>Show measured data and distribution</summary>
          <figure class="chart-figure">
            <figcaption id="strcmp-hist-cap" class="chart-caption">Distribution view: two curves that <strong>overlap</strong> = no timing difference; a curve <strong>shifted right</strong> = slower = leak.</figcaption>
            <canvas id="strcmp-hist" aria-label="Histogram comparing vulnerable and constant-time string comparison timings" role="img" aria-describedby="strcmp-hist-cap"></canvas>
          </figure>
          <div id="strcmp-table"></div>
        </details>
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
        <figure class="chart-figure">
          <figcaption id="hmac-cap" class="chart-caption">What you are looking at: verification time vs. how many MAC bytes the forgery got right. A line <strong>rising to the right</strong> means each extra correct byte makes the early-exit compare run one step further before rejecting, so a <em>slower</em> response marks a correct byte — leak the MAC one byte at a time. A <strong>flat line</strong> is the constant-time compare. The chart samples five prefix lengths (0&ndash;16 of the tag's 32 bytes) as sparse points on that curve, and each candidate is built from the known expected MAC — this calibrates the oracle's timing; it does not recover an unknown MAC.</figcaption>
          <canvas id="hmac-line" aria-label="Line chart of HMAC timing by correct prefix length" role="img" aria-describedby="hmac-cap"></canvas>
        </figure>
        <p id="hmac-summary" class="chart-summary" aria-live="polite"></p>
        <div id="hmac-verdict" class="verdict" role="status" aria-live="polite"></div>
        <details class="chart-data"><summary>Show measured data</summary><div id="hmac-table"></div></details>
        <p class="panel-note">Reference: Django timing attack CVEs and the history of constant-time comparison APIs such as Python <code>hmac.compare_digest</code>.</p>
        <p class="panel-note panel-caveat"><strong>Honest caveat:</strong> the "constant-time" JS here has a uniform <em>instruction schedule</em>, but JavaScript is not truly constant-time at the engine level — JIT, GC, and branch prediction can still add data-dependent variation. In production, use a vetted native primitive.</p>
      </section>

      <section class="panel" aria-labelledby="panel3-title">
        <div class="panel-head">
          <h2 id="panel3-title">Panel 3 — RSA Private Key Bit Leakage</h2>
          <span class="status warn">Always use constant-time exponentiation</span>
        </div>
        <p class="panel-text">Square-and-multiply uses a secret-dependent branch on each exponent bit. Montgomery ladder keeps operation count uniform.</p>
        <button id="rsa-run" type="button">Generate toy RSA key and measure bit leakage</button>

        <div class="mechanism" id="rsa-mech" aria-labelledby="rsa-mech-title">
          <div class="mechanism-head">
            <h3 id="rsa-mech-title" class="mechanism-title">Why the ladder is uniform — bit by bit</h3>
            <button id="rsa-mech-play" class="mech-play" type="button" aria-label="Replay the square-and-multiply animation">▶ Replay</button>
          </div>
          <p class="mechanism-lead">These are the low ${EXPONENT_WINDOW_BITS} bits of the generated private exponent, leading zeros included so the width never changes between runs. Naive square-and-multiply does an extra multiply (<code>×</code>) only on a <strong>1</strong>-bit, so its multiply count equals the secret's Hamming weight. The ladder does one square and one multiply on <em>every</em> bit.</p>
          <div class="mech-bitrow" data-role="bit-row" role="img" aria-label="Exponent bits; ones trigger an extra multiply"></div>
          <div class="mech-counters" aria-live="polite">
            <span class="mech-counter mech-counter--vuln">Naive (leaks): <strong data-role="naive-tally">—</strong></span>
            <span class="mech-counter mech-counter--ct">Ladder (uniform): <strong data-role="ladder-tally">—</strong></span>
          </div>
          <p class="mech-status" data-role="exp-status" aria-live="polite"></p>
        </div>

        <figure class="chart-figure">
          <figcaption id="rsa-cap" class="chart-caption">What you are looking at: timing distributions per method and secret bit. If the two <strong>naive</strong> curves separate but the two <strong>ladder</strong> curves overlap, the naive branch leaks the bit and the ladder does not.</figcaption>
          <canvas id="rsa-hist" aria-label="Histogram of RSA timing under different private key bit patterns" role="img" aria-describedby="rsa-cap"></canvas>
        </figure>
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
        <figure class="chart-figure">
          <figcaption id="cache-cap" class="chart-caption">What you are looking at: access-time distributions for data already in cache vs. evicted. A <strong>right-shifted uncached</strong> curve means cache state changes latency — and secret-dependent lookups leak through it.</figcaption>
          <canvas id="cache-hist" aria-label="Histogram of cached and uncached memory access timings" role="img" aria-describedby="cache-cap"></canvas>
        </figure>
        <div class="cache-grid" aria-label="Reference diagram of typical memory-hierarchy latencies. These are textbook figures, not measurements from this machine." role="img">
          <div><strong>L1</strong><span id="l1-v">~1 ns</span></div>
          <div><strong>L2</strong><span id="l2-v">~4 ns</span></div>
          <div><strong>L3</strong><span id="l3-v">~12 ns</span></div>
          <div><strong>DRAM</strong><span id="dram-v">~80 ns</span></div>
        </div>
        <p class="panel-note panel-caveat"><strong>Note:</strong> the L1–DRAM ladder above is a <em>fixed reference diagram</em> of typical hardware latencies, not values measured in your browser. The measured result is the cached-vs-uncached chart; browsers cannot expose real cache-line timing to JavaScript.</p>
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
          <li>Use a password-hashing KDF (argon2id, scrypt, bcrypt) for passwords &mdash; never compare a plaintext password at all. Use a vetted fixed-time comparison for the fixed-length things: MACs, hashes, verifiers and secret tokens.</li>
          <li>Use hardware crypto (AES-NI, WebCrypto) over software table implementations.</li>
        </ol>
        <p class="panel-note panel-caveat"><strong>Caveat for this demo:</strong> the constant-time code here fixes the instruction schedule (no secret-dependent branch, loop, or memory access), which is the property being taught — but a managed runtime like JavaScript is not guaranteed constant-time end-to-end. Real deployments rely on audited native primitives (libsodium, BoringSSL) and, where possible, hardware instructions.</p>
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
  const sweepCanvas = byId<HTMLCanvasElement>("strcmp-sweep");
  const histCanvas = byId<HTMLCanvasElement>("strcmp-hist");
  const summary = byId<HTMLParagraphElement>("strcmp-summary");
  const table = byId<HTMLDivElement>("strcmp-table");
  const modeledToggle = byId<HTMLInputElement>("strcmp-modeled");

  // Deterministic mechanism animation — the causal core, immune to timer noise.
  const mechRoot = byId<HTMLDivElement>("strcmp-mech");
  const mechPlay = byId<HTMLButtonElement>("strcmp-mech-play");
  const compareAnimator = createCompareAnimator(mechRoot, mechPlay);
  function refreshMechanism(): void {
    compareAnimator.render(targetInput.value, guessInput.value);
  }
  let stats: ComparisonStats | null = null;

  /** Drop a measurement whose inputs have since changed (see STALE_VERDICT). */
  function invalidate(): void {
    if (!stats) {
      return;
    }
    stats = null;
    summary.textContent = "";
    table.innerHTML = "";
    clearCanvas(sweepCanvas);
    clearCanvas(histCanvas);
    setVerdict("strcmp-verdict", STALE_VERDICT);
  }

  function onInput(): void {
    refreshMechanism();
    invalidate();
  }
  targetInput.addEventListener("input", onInput);
  guessInput.addEventListener("input", onInput);
  refreshMechanism();

  function draw(): void {
    if (!stats) {
      return;
    }
    // PRIMARY visual: time vs. correct-prefix length — the attack model, made visible.
    const series: LineSeries[] = [
      { label: "Vulnerable", points: stats.sweep.map((p) => ({ x: p.matchedPrefix, y: p.vulnerableMean })), color: VULN },
      { label: "Constant-Time", points: stats.sweep.map((p) => ({ x: p.matchedPrefix, y: p.constantMean })), color: SAFE }
    ];
    if (modeledToggle.checked) {
      // Overlay the ideal signal (work ∝ prefix length), scaled onto the measured
      // vulnerable range so its SHAPE is comparable. Explicitly modeled, not measured.
      const measuredMax = Math.max(...stats.sweep.map((p) => p.vulnerableMean), 1e-6);
      const measuredMin = Math.min(...stats.sweep.map((p) => p.vulnerableMean));
      const costs = stats.sweep.map((p) => modeledPrefixCost(targetInput.value, p.matchedPrefix));
      const costMax = Math.max(...costs, 1);
      const costMin = Math.min(...costs);
      const costSpan = Math.max(1, costMax - costMin);
      series.push({
        label: "Modeled (not measured)",
        points: stats.sweep.map((p, i) => ({
          x: p.matchedPrefix,
          y: measuredMin + ((costs[i] - costMin) / costSpan) * (measuredMax - measuredMin)
        })),
        color: "#8a5cff"
      });
    }
    renderLineChart(sweepCanvas, series, "Comparison time by correct leading characters");

    renderHistogram(
      histCanvas,
      [
        { label: "Vulnerable", values: stats.vulnerableSamples, color: VULN },
        { label: "Constant-Time", values: stats.constantSamples, color: SAFE }
      ],
      "String comparison timing distribution"
    );

    // Per-byte cost of one comparison. The measured endpoints are batch totals
    // over `loopsPerTimedBatch` comparisons and span `bytesSpanned` characters,
    // so both divisors matter. An earlier version divided the raw batch-time
    // delta by stats.sweep.length — the number of chart points — and labelled
    // the result "ms per extra correct byte", which it was not.
    const sweepGain = stats.vulnerableLongPrefixMs - stats.vulnerableShortPrefixMs;
    const bytesSpanned = Math.max(1, stats.longPrefixChars - stats.shortPrefixChars);
    const msPerByteBatch = sweepGain / bytesSpanned;
    const usPerByteSingle = (msPerByteBatch / stats.loopsPerTimedBatch) * 1000;
    summary.textContent =
      `Prefix match length: ${stats.prefixMatchLength} chars. ` +
      `Going from ${stats.shortPrefixChars} to ${stats.longPrefixChars} correct leading characters changed the vulnerable batch time by ` +
      `${sweepGain.toFixed(4)} ms over ${stats.loopsPerTimedBatch.toLocaleString()} comparisons — ` +
      `~${usPerByteSingle.toFixed(5)} microseconds per extra correct character per comparison. ` +
      `That is the size of the per-guess signal such an attack would have to average over; this panel measures the signal, it does not attempt the recovery. ` +
      `Constant-time mean ${stats.constantMean.toFixed(4)} ms (sigma ${stats.constantStdDev.toFixed(4)}). ` +
      `${stats.iterationsPerMode.toLocaleString()} real comparisons per mode via performance.now().`;
    setVerdict(
      "strcmp-verdict",
      stringComparisonVerdict(
        stats.vulnerableShortPrefixMs,
        stats.vulnerableLongPrefixMs,
        // Constant-time sweep endpoints (0 -> full prefix), so the verdict can
        // report what that path measurably did instead of asserting it was flat.
        stats.sweep[0].constantMean,
        stats.sweep[stats.sweep.length - 1].constantMean,
        stats.vulnerableSamples.length
      )
    );
    renderDataTable(
      table,
      "Vulnerable vs constant-time batch time by number of correct leading characters",
      ["Correct chars", "Vulnerable (ms)", "Constant-time (ms)"],
      stats.sweep.map((point) => [point.matchedPrefix, point.vulnerableMean, point.constantMean])
    );
  }
  redraws.push(draw);
  modeledToggle.addEventListener("change", draw);

  async function execute(): Promise<void> {
    stats = benchmarkStringComparisons(targetInput.value, guessInput.value, 10000);
    refreshMechanism();
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
  /**
   * Retires in-flight runs as well as rendered ones.
   *
   * This is the only panel whose benchmark awaits (WebCrypto importKey/sign
   * inside benchmarkHmacVerification), so it is the only one with a window
   * between reading the inputs and publishing the result. Editing the message
   * inside that window used to leave the old message's MAC and its verdict
   * rendered beside the new controls: invalidate() returned early because
   * `stats` was still null, and the run then resolved and drew itself anyway.
   * The window is only as wide as one WebCrypto round trip — well under a
   * millisecond here — but an input event merely has to be queued during it,
   * and a verdict outliving the input that produced it is the exact failure
   * this panel's stale handling exists to prevent.
   *
   * A monotonic generation id makes the ordering explicit: a run publishes only
   * if no invalidation happened after it started.
   */
  let generation = 0;
  let inFlight = false;

  /** Drop a measurement whose inputs have since changed (see STALE_VERDICT). */
  function invalidate(): void {
    generation += 1;
    if (!stats && !inFlight) {
      return;
    }
    stats = null;
    summary.textContent = "";
    table.innerHTML = "";
    error.textContent = "";
    clearCanvas(canvas);
    setVerdict("hmac-verdict", STALE_VERDICT);
  }
  messageInput.addEventListener("input", invalidate);
  forgedInput.addEventListener("input", invalidate);

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
    setVerdict("hmac-verdict", hmacVerdict(vulnerableSlope, constantSlope, stats.points[0].vulnerableMean, stats.vulnerableSeries.length));
    renderDataTable(
      table,
      "Mean verification time by number of correct MAC prefix bytes",
      ["Correct bytes", "Vulnerable (ms)", "Constant-time (ms)"],
      stats.points.map((p) => [p.prefixBytes, p.vulnerableMean, p.constantMean])
    );
  }
  redraws.push(draw);

  async function execute(): Promise<void> {
    const myGeneration = ++generation;
    // Read the inputs once, up front. Everything below reports on THIS pair.
    const snapshot = { message: messageInput.value, forged: forgedInput.value };
    inFlight = true;
    error.textContent = "";
    try {
      const measured = await benchmarkHmacVerification(snapshot.message, snapshot.forged, 8000);
      if (myGeneration !== generation) {
        return; // inputs changed mid-run; invalidate() already said so
      }
      stats = measured;
      draw();
    } catch (caught) {
      if (myGeneration !== generation) {
        return;
      }
      stats = null;
      error.textContent = caught instanceof Error ? caught.message : "HMAC benchmark failed.";
      summary.textContent = "HMAC timing run failed; adjust forged MAC hex and retry.";
      table.innerHTML = "";
      clearCanvas(canvas);
      // Without this the panel keeps the PREVIOUS run's verdict — a "Leak
      // detected" banner sitting on top of a run that never happened.
      setVerdict("hmac-verdict", {
        tone: "inconclusive",
        label: "Run failed — nothing measured",
        detail: `${error.textContent} No timing was recorded this run; fix the input above and press the button again.`
      });
    } finally {
      // withRunning() blocks re-entry on this button, and the lazy auto-run goes
      // through it too, so at most one HMAC run is ever in flight.
      inFlight = false;
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

  // Deterministic bit-schedule animation for the generated private exponent.
  const mechRoot = byId<HTMLDivElement>("rsa-mech");
  const mechPlay = byId<HTMLButtonElement>("rsa-mech-play");
  const exponentAnimator = createExponentAnimator(mechRoot, mechPlay);
  // Seed with a representative pattern until a real key is generated on run.
  exponentAnimator.render(0b1011010011, EXPONENT_WINDOW_BITS);

  let stats: RsaTimingStats | null = null;

  function draw(): void {
    if (!stats) {
      return;
    }
    exponentAnimator.render(stats.exponentLowBits, EXPONENT_WINDOW_BITS);
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
      `WebCrypto RSA-PSS sign mean=${stats.webCryptoSignMeanMs.toFixed(4)} ms ` +
      // Different key size, algorithm and runtime: a reference point, not a
      // comparison — and a stable mean is not evidence it is constant-time.
      `(native 1024-bit API, listed as a performance reference only — not part of the leak comparison above).`;
    setVerdict("rsa-verdict", rsaVerdict(naiveGap, ladderGap, stats.naiveBit0Mean, stats.naiveBit0Samples.length));
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
      const reason = caught instanceof Error ? caught.message : "RSA benchmark failed.";
      summary.textContent = reason;
      table.innerHTML = "";
      clearCanvas(canvas);
      setVerdict("rsa-verdict", {
        tone: "inconclusive",
        label: "RSA run failed",
        // Name the actual cause: the old text always blamed key generation even
        // when the failure came from somewhere else in the run.
        detail: `${reason} Nothing was measured this run; press the button to try again.`
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
    // The L1–DRAM ladder is deliberately NOT touched here. It is a static
    // reference diagram of typical hardware latencies; rewriting those cells on
    // every run made canned constants look like this machine's measurements.
    summary.textContent =
      `Measured cached mean=${stats.cachedMean.toFixed(4)} ms, uncached mean=${stats.uncachedMean.toFixed(4)} ms. ` +
      // Name the mechanism as the likely driver, not the proven cause: this
      // page cannot rule out prefetching, frequency scaling, GC or the
      // scheduler, and it cannot see which cache level anything landed in.
      `Cache-line residency is the mechanism this experiment is built around and the likely driver of that gap, but JavaScript cannot isolate it — prefetching, frequency scaling, GC and scheduler noise can all contribute. ` +
      `WebCrypto delegates AES to the browser's native crypto backend instead of running key-dependent table lookups in page JavaScript, which removes this channel's classic entry point.`;
    setVerdict("cache-verdict", cacheVerdict(stats.cachedMean, stats.uncachedMean, stats.cachedSamples.length));
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
  const panels: Array<[string, () => Promise<void>]> = [
    ["strcmp-run", wireStringPanel()],
    ["hmac-run", wireHmacPanel()],
    ["rsa-run", wireRsaPanel()],
    ["cache-run", wireCachePanel()]
  ];
  wireResizeRedraw();

  // Defer each panel's benchmark until it scrolls into view (during idle time),
  // so initial load does almost no work. Below-the-fold panels — including the
  // heavy RSA panel — never run until the user reaches them.
  for (const [id, run] of panels) {
    const button = byId<HTMLButtonElement>(id);
    const target = button.closest("section") ?? button;
    runWhenVisible(target, () => void withRunning(button, run));
  }
}
