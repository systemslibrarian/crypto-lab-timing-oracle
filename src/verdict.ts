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

/**
 * What one panel's threshold comparison is, and is not, entitled to say.
 *
 * A run here compares two means from a fixed number of samples, in one browser,
 * on one loaded machine, against a single fixed ratio. That is enough to report
 * that a difference was *observed under these conditions*. It is not enough to
 * report that a key is recoverable: exploitability depends on the attacker's
 * timer resolution, on how the measurement distributions overlap, and on how
 * many queries the real target permits — none of which this page measures.
 *
 * So every verdict below states the observation and its scope, and keeps the
 * separate, genuinely established claim about the *algorithm* clearly marked as
 * background rather than as this run's finding. An earlier version said things
 * like "an attacker can recover the secret one character at a time" on a single
 * threshold crossing, and — worse — said a leak was "statistically still
 * exploitable" in the branch where nothing had been resolved at all.
 */
function scope(samples: number): string {
  return `Measured over ${samples} samples in this browser on this machine; a different machine, load level or sample count can land the other way.`;
}

/** String comparison: does runtime grow with the number of correct leading chars? */
export function stringComparisonVerdict(shortPrefixMs: number, longPrefixMs: number, samples: number): Verdict {
  const gap = relativeGap(longPrefixMs, shortPrefixMs);
  const grows = longPrefixMs > shortPrefixMs;
  const pct = (gap * 100).toFixed(0);
  if (grows && gap >= LEAK_RATIO) {
    return {
      tone: "leak",
      label: "Timing signal observed this run",
      detail: `Vulnerable runtime rose ~${pct}% from a short to a full correct prefix, while the constant-time path stayed flat. ${scope(samples)} That is evidence the early-exit compare is distinguishable here, not a measurement of whether the secret is recoverable — this page never attempts the recovery. Character-at-a-time recovery against an early-exit compare is a well-established attack, which is the reason the pattern is avoided.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Prefix-length effect was ~${pct}% this run — under the ${(LEAK_RATIO * 100).toFixed(0)}% ratio this panel treats as observable. ${scope(samples)} This says the difference was not resolved here; it is not evidence that the compare is constant-time, since browser timer coarsening can hide a real per-character difference. Read the source: the vulnerable path still returns early.`
  };
}

/** HMAC verification: does runtime rise with matching prefix bytes? */
export function hmacVerdict(
  vulnerableSlopeMs: number,
  constantSlopeMs: number,
  baselineMs: number,
  samples: number
): Verdict {
  const vulnGap = Math.abs(vulnerableSlopeMs) / Math.max(baselineMs, 1e-9);
  if (vulnerableSlopeMs > 0 && vulnGap >= LEAK_RATIO && Math.abs(vulnerableSlopeMs) > Math.abs(constantSlopeMs)) {
    return {
      tone: "leak",
      label: "Timing signal observed this run",
      detail: `Byte-by-byte verification time climbed with each correct MAC byte, and by more than the constant-time line did. ${scope(samples)} No forgery was attempted here, so this is a distinguishable timing difference rather than a demonstrated forgery oracle. Use a constant-time compare (e.g. hmac.compare_digest) regardless of what this run resolved.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Prefix slope was small relative to baseline this run. ${scope(samples)} Browser timer coarsening can hide a per-byte difference, so this is not evidence the compare is safe — the vulnerable path in the source still exits on the first mismatched byte.`
  };
}

/** RSA exponentiation: is the naive method bit-dependent while the ladder is not? */
export function rsaVerdict(
  naiveGapMs: number,
  ladderGapMs: number,
  baselineMs: number,
  samples: number
): Verdict {
  const naiveRel = naiveGapMs / Math.max(baselineMs, 1e-9);
  const ladderRel = ladderGapMs / Math.max(baselineMs, 1e-9);
  if (naiveRel >= LEAK_RATIO && naiveGapMs > ladderGapMs) {
    return {
      tone: "leak",
      label: "Bit-dependent gap observed this run",
      detail: `Square-and-multiply timing tracked the secret exponent bit (gap ~${(naiveRel * 100).toFixed(0)}% vs ladder ~${(ladderRel * 100).toFixed(0)}%). ${scope(samples)} This is a toy key and no exponent bit was actually recovered here. Kocher (1996) recovered real RSA keys from exactly this branch, which is why the Montgomery ladder runs the same operations regardless of the bit.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Bit-dependent gap was small this run on this toy key. ${scope(samples)} The naive path in the source is still branch-on-bit, so this is a limit of the measurement rather than a property of the algorithm. Kocher (1996) recovered real RSA keys from exactly this branch; always use a constant-time ladder.`
  };
}

/** Cache timing: is cached access observably faster than uncached? */
export function cacheVerdict(cachedMs: number, uncachedMs: number, samples: number): Verdict {
  const gap = relativeGap(uncachedMs, cachedMs);
  if (uncachedMs > cachedMs && gap >= LEAK_RATIO) {
    return {
      tone: "leak",
      label: "Cache state observable this run",
      detail: `Uncached access was ~${(gap * 100).toFixed(0)}% slower than cached. ${scope(samples)} No key was extracted here — this shows the two access patterns are distinguishable on this machine, which is the channel Bernstein (2005) used to extract AES keys. Secret-dependent table lookups (e.g. software AES S-boxes) ride this channel; prefer AES-NI / WebCrypto.`
    };
  }
  return {
    tone: "inconclusive",
    label: "Signal below noise this run",
    detail: `Cache effect was small this run — the working set may already fit in cache, or the timer is too coarse. ${scope(samples)} Bernstein (2005) extracted AES keys via this exact channel, so a small gap here is a statement about this measurement, not about the channel.`
  };
}
