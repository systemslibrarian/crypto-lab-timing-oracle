# crypto-lab-timing-oracle

## What It Is

`crypto-lab-timing-oracle` is a browser demo of timing side-channel behavior in string comparison, WebCrypto HMAC-SHA-256 verification, toy RSA arithmetic, and cache-sensitive memory access patterns. It shows vulnerable and constant-time implementations side by side using live browser timing measurements. The core cryptographic primitives in this demo are HMAC-SHA-256 and RSA, while the timing panels illustrate how implementation choices can leak secret-dependent information. HMAC is a symmetric primitive and RSA is an asymmetric primitive, and both are evaluated here under a side-channel threat model where attackers observe timing differences.

## When to Use It

- Use it to teach why constant-time comparison is required for MAC and secret checks, because it makes timing leakage visible with repeatable measurements.
- Use it in secure coding workshops for HMAC and RSA implementations, because it pairs vulnerable and defensive patterns in one place.
- Use it when validating threat modeling assumptions for browser-adjacent crypto code, because it demonstrates how timing observations can still reveal patterns even with reduced timer precision.
- Do NOT use it as a production cryptography library, because it is an educational demo with intentionally vulnerable code paths.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-timing-oracle](https://systemslibrarian.github.io/crypto-lab-timing-oracle/)**

The demo lets you run timing experiments for string comparison, HMAC verification, RSA exponentiation behavior, and cache access timing. You can change controls such as target secret string, attacker guess string, message, and forged MAC hex, then trigger benchmark runs to compare vulnerable versus constant-time outcomes. Iteration counts and experiment parameters are built into each panel button action rather than exposed as free-form inputs. Each panel turns its raw measurements into a plain-language verdict (for example "Leak detected" or "Signal below noise this run"), renders a theme-aware chart with a legend and labelled axes, and exposes the underlying numbers in a collapsible data table for screen readers and copy-paste. Benchmarks run after first paint with a visible "Running…" state so the page stays responsive, and charts redraw on theme change and resize without re-measuring.

## What Can Go Wrong

- Naive `==`/`memcmp`-style comparison of secrets, MACs, or tokens returns early on the first mismatched byte, leaking how much of a guess is correct one character at a time.
- Secret-dependent branches and table lookups (square-and-multiply exponentiation, S-box accesses) create data-dependent timing that statistical sampling can amplify into key recovery.
- A "no leak" result in a coarse-timer environment is not a safety proof — a more precise timer, a co-resident attacker, or more samples can resolve a signal this run could not.
- Cache-timing depends on the memory hierarchy and can leak across process and tenant boundaries, so even "constant-time" source can be undermined by the CPU and compiler.
- Source-level constant-time discipline does not guarantee engine-level constant time: a JIT, GC, bounds checks, or string interning can reintroduce data-dependent timing the language cannot control.

## Real-World Usage

- Constant-time comparison (`crypto.timingSafeEqual`, `hmac.compare`, `sodium_memcmp`) is the standard defense for verifying MACs, password hashes, and bearer tokens.
- RSA implementations apply blinding to defend against timing recovery of the private exponent, a class of attack documented by Kocher.
- TLS stacks were hardened against MAC/padding timing oracles such as Lucky 13 by equalizing processing time across valid and invalid records.
- Constant-time programming is a baseline requirement in vetted libraries (libsodium, BoringSSL, the `@noble` family) and in formally verified code such as HACL*.
- Cloud and multi-tenant environments treat cache-timing as a real cross-tenant threat, which is part of why browsers coarsened high-resolution timers after Spectre.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-timing-oracle
cd crypto-lab-timing-oracle
npm install
npm run dev
```

## Related Demos
- [crypto-lab-padding-oracle](https://systemslibrarian.github.io/crypto-lab-padding-oracle/) — another decryption-via-oracle side channel, exploiting CBC/PKCS#7 padding feedback.
- [crypto-lab-kyberslash](https://systemslibrarian.github.io/crypto-lab-kyberslash/) — a real timing attack on ML-KEM via non-constant-time division.
- [crypto-lab-hqc-timing](https://systemslibrarian.github.io/crypto-lab-hqc-timing/) — a decoder timing oracle against the HQC post-quantum KEM.
- [crypto-lab-lattice-fault](https://systemslibrarian.github.io/crypto-lab-lattice-fault/) — fault injection against lattice schemes, a sibling implementation-attack class.
- [crypto-lab-nonce-guard](https://systemslibrarian.github.io/crypto-lab-nonce-guard/) — how nonce misuse, another implementation pitfall, breaks AES-GCM.

## Caveats and Limitations

This is a teaching tool, and two of its mechanisms are illustrative rather than literal. Read these before drawing conclusions from the numbers:

- **The "constant-time" comparators are not guaranteed constant-time at the engine level.** They are written without secret-dependent branches or early exits, which is the correct *source-level* discipline. But JavaScript engines (JIT, bounds checks, string interning, garbage collection) can still introduce data-dependent timing that the language does not let you control. Real constant-time guarantees require a lower-level language and careful compiler/CPU consideration. Treat the constant-time panels as demonstrating the right *pattern*, not a hardened implementation.
- **The L1/L2/L3/DRAM nanosecond figures in the cache panel are fixed illustrative constants, not measurements.** They depict the shape of the memory hierarchy. The *cached vs. uncached* histogram beside them is measured live; the per-level latency table is a static reference diagram.

More broadly: browser timers are intentionally coarsened after Spectre mitigations, so a "Signal below noise this run" verdict means this environment could not resolve the leak — not that the underlying code is safe. The vulnerable patterns shown here have leaked real keys in production with precise timers and statistical analysis. The RSA panel uses a deliberately tiny "toy" key for speed and is not a real key size.

## Verification

```bash
npm test       # run the vitest unit + DOM integration suite
npm run build  # type-check (tsc) and produce a production build in dist/
```

The crypto primitives (constant-time comparison, hex parsing, the timing-leak verdicts, and the statistics helpers) are covered by unit tests, and a happy-dom integration test boots the full UI headless. Tests run in CI before every GitHub Pages deploy. No environment variables are required.

---

*One of 60+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
