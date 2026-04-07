# crypto-lab-timing-oracle

Live demo: https://systemslibrarian.github.io/crypto-lab-timing-oracle/

Timing Attack · Constant-Time · HMAC · RSA · Cache-Timing

## Overview

`crypto-lab-timing-oracle` is a browser-based interactive demo showing timing side-channel attacks and constant-time defenses side by side. It uses real measurements from `performance.now()` and `performance.mark()`, with no simulated timing data.

## Attacks Covered

1. String comparison timing leak from early-exit mismatch logic.
2. HMAC verification leak from naive byte-by-byte comparison.
3. RSA private key bit leakage in square-and-multiply exponentiation.
4. Cache-timing leakage model for secret-dependent table lookups.
5. Defensive constant-time coding patterns and historical incidents.

## Primitives Used

1. WebCrypto HMAC-SHA-256 for MAC generation and verification experiments.
2. Toy RSA arithmetic for branch-dependent exponentiation timing demonstrations.
3. JavaScript typed arrays for cache residency timing experiments.
4. Browser timing APIs: `performance.now()` and `performance.mark()`.

## Running Locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Deploy to GitHub Pages:

```bash
npm run deploy
```

## Security Notes

This demo uses real timing sources, but browser timer resolution is reduced by Spectre mitigations. Real-world exploitation usually requires more samples and stronger statistical analysis than shown here. The vulnerable implementation patterns are still real and have caused production cryptographic failures.

References:

1. Kocher (1996), *Timing Attacks on Implementations of Diffie-Hellman, RSA, DSS, and Other Systems*.
2. Bernstein (2005), cache-timing attacks on AES software table lookups.

## Accessibility

Designed for WCAG 2.1 AA goals:

1. Keyboard-navigable controls and visible focus indicators.
2. Screen-reader-friendly labels and live status messaging.
3. Text summaries for charts so timing differences are not color-only.
4. Responsive layout and reduced-motion support via `prefers-reduced-motion`.

## Why This Matters

Cryptography can fail even when the algorithm is correct, if implementation timing leaks secret-dependent behavior. Constant-time programming is a core security requirement for handling secrets.

## Related Demos

1. https://github.com/systemslibrarian/crypto-lab-aes-modes
2. https://github.com/systemslibrarian/crypto-lab-mac-race
3. https://github.com/systemslibrarian/crypto-lab-rsa-forge
4. https://github.com/systemslibrarian/crypto-compare
5. https://github.com/systemslibrarian/crypto-lab

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31