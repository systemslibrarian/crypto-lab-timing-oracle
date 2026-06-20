# crypto-lab-timing-oracle

Live demo: https://systemslibrarian.github.io/crypto-lab-timing-oracle/

Timing Attack · Constant-Time · HMAC · RSA · Cache-Timing

## 1. What It Is

`crypto-lab-timing-oracle` is a browser demo of timing side-channel behavior in string comparison, WebCrypto HMAC-SHA-256 verification, toy RSA arithmetic, and cache-sensitive memory access patterns. It shows vulnerable and constant-time implementations side by side using live browser timing measurements. The core cryptographic primitives in this demo are HMAC-SHA-256 and RSA, while the timing panels illustrate how implementation choices can leak secret-dependent information. HMAC is a symmetric primitive and RSA is an asymmetric primitive, and both are evaluated here under a side-channel threat model where attackers observe timing differences.

## 2. When to Use It

- Use it to teach why constant-time comparison is required for MAC and secret checks, because it makes timing leakage visible with repeatable measurements.
- Use it in secure coding workshops for HMAC and RSA implementations, because it pairs vulnerable and defensive patterns in one place.
- Use it when validating threat modeling assumptions for browser-adjacent crypto code, because it demonstrates how timing observations can still reveal patterns even with reduced timer precision.
- Do not use it as a production cryptography library, because it is an educational demo with intentionally vulnerable code paths.

## 3. Live Demo

Live demo: https://systemslibrarian.github.io/crypto-lab-timing-oracle/

The demo lets you run timing experiments for string comparison, HMAC verification, RSA exponentiation behavior, and cache access timing. You can change controls such as target secret string, attacker guess string, message, and forged MAC hex, then trigger benchmark runs to compare vulnerable versus constant-time outcomes. Iteration counts and experiment parameters are built into each panel button action rather than exposed as free-form inputs.

Each panel turns its raw measurements into a plain-language verdict (for example "Leak detected" or "Signal below noise this run"), renders a theme-aware chart with a legend and labelled axes, and exposes the underlying numbers in a collapsible data table for screen readers and copy-paste. Benchmarks run after first paint with a visible "Running…" state so the page stays responsive, and charts redraw on theme change and resize without re-measuring.

## 4. How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-timing-oracle.git
cd crypto-lab-timing-oracle
npm install
npm run dev
```

No environment variables are required.

Other scripts:

```bash
npm test       # run the vitest unit + DOM integration suite
npm run build  # type-check (tsc) and produce a production build in dist/
```

The crypto primitives (constant-time comparison, hex parsing, the timing-leak verdicts, and the statistics helpers) are covered by unit tests, and a happy-dom integration test boots the full UI headless. Tests run in CI before every GitHub Pages deploy.

## 5. Caveats and Limitations

This is a teaching tool, and two of its mechanisms are illustrative rather than literal. Read these before drawing conclusions from the numbers:

- **The "constant-time" comparators are not guaranteed constant-time at the engine level.** They are written without secret-dependent branches or early exits, which is the correct *source-level* discipline. But JavaScript engines (JIT, bounds checks, string interning, garbage collection) can still introduce data-dependent timing that the language does not let you control. Real constant-time guarantees require a lower-level language and careful compiler/CPU consideration. Treat the constant-time panels as demonstrating the right *pattern*, not a hardened implementation.
- **The L1/L2/L3/DRAM nanosecond figures in the cache panel are fixed illustrative constants, not measurements.** They depict the shape of the memory hierarchy. The *cached vs. uncached* histogram beside them is measured live; the per-level latency table is a static reference diagram.

More broadly: browser timers are intentionally coarsened after Spectre mitigations, so a "Signal below noise this run" verdict means this environment could not resolve the leak — not that the underlying code is safe. The vulnerable patterns shown here have leaked real keys in production with precise timers and statistical analysis. The RSA panel uses a deliberately tiny "toy" key for speed and is not a real key size.

## 6. Part of the Crypto-Lab Suite

This demo is part of the larger Crypto-Lab collection at https://systemslibrarian.github.io/crypto-lab/.

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31