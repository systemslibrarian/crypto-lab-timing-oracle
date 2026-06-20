export type VerdictTone = "leak" | "safe" | "inconclusive";

export type Verdict = {
  tone: VerdictTone;
  label: string;
  detail: string;
};

/**
 * Relative gap between two timings. Using a ratio (not an absolute ms delta)
 * keeps the threshold meaningful across machines with very different speeds.
 */
export function relativeGap(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base;
}

const LEAK_RATIO = 0.15; // >=15% runtime swing counts as an observable signal

/** String comparison: does runtime grow with the number of correct leading chars? */
export function stringComparisonVerdict(shortPrefixMs: number, longPrefixMs: number): Verdict {
  const gap = relativeGap(longPrefixMs, shortPrefixMs);
  const grows = longPrefixMs > shortPrefixMs;
  const pct = (gap * 100).toFixed(0);
  if (grows && gap >= LEAK_RATIO) {
    return {
      tone: "leak",
      label: "Leak detected",
      detail: `Vulnerable runtime rose ~${pct}% from a short to a full correct prefix. An attacker can recover the secret one character at a time. The constant-time path stays flat.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Prefix-length effect was ~${pct}% this run — within timer noise on this machine. Re-run, or the early-exit leak is masked by reduced timer precision; statistically it is still exploitable.`
  };
}

/** HMAC verification: does runtime rise with matching prefix bytes? */
export function hmacVerdict(vulnerableSlopeMs: number, constantSlopeMs: number, baselineMs: number): Verdict {
  const vulnGap = Math.abs(vulnerableSlopeMs) / Math.max(baselineMs, 1e-9);
  if (vulnerableSlopeMs > 0 && vulnGap >= LEAK_RATIO && Math.abs(vulnerableSlopeMs) > Math.abs(constantSlopeMs)) {
    return {
      tone: "leak",
      label: "Leak detected",
      detail: `Byte-by-byte verification time climbs with each correct MAC byte — a forgery oracle. Use a constant-time compare (e.g. hmac.compare_digest). The constant-time line is flat.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Prefix slope was small relative to baseline this run. Browser timer coarsening hides per-byte differences; with native timers the early-exit compare leaks the MAC.`
  };
}

/** RSA exponentiation: is the naive method bit-dependent while the ladder is not? */
export function rsaVerdict(naiveGapMs: number, ladderGapMs: number, baselineMs: number): Verdict {
  const naiveRel = naiveGapMs / Math.max(baselineMs, 1e-9);
  const ladderRel = ladderGapMs / Math.max(baselineMs, 1e-9);
  if (naiveRel >= LEAK_RATIO && naiveGapMs > ladderGapMs) {
    return {
      tone: "leak",
      label: "Naive leaks; ladder uniform",
      detail: `Square-and-multiply timing depends on the secret exponent bit (gap ~${(naiveRel * 100).toFixed(0)}% vs ladder ~${(ladderRel * 100).toFixed(0)}%). The Montgomery ladder runs the same operations regardless of the bit.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Bit-dependent gap was small this run on this toy key. Kocher (1996) recovered real RSA keys from exactly this branch; always use a constant-time ladder.`
  };
}

/** Cache timing: is cached access observably faster than uncached? */
export function cacheVerdict(cachedMs: number, uncachedMs: number): Verdict {
  const gap = relativeGap(uncachedMs, cachedMs);
  if (uncachedMs > cachedMs && gap >= LEAK_RATIO) {
    return {
      tone: "leak",
      label: "Cache state is observable",
      detail: `Uncached access was ~${(gap * 100).toFixed(0)}% slower than cached. Secret-dependent table lookups (e.g. software AES S-boxes) leak through this channel; prefer AES-NI / WebCrypto.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Cache effect was small this run — the working set may already fit in cache, or the timer is too coarse. Bernstein (2005) extracted AES keys via this exact channel.`
  };
}
