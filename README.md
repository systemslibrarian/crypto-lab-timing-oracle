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

## 4. How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-timing-oracle.git
cd crypto-lab-timing-oracle
npm install
npm run dev
```

No environment variables are required.

## 5. Part of the Crypto-Lab Suite

This demo is part of the larger Crypto-Lab collection at https://systemslibrarian.github.io/crypto-lab/.

So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31