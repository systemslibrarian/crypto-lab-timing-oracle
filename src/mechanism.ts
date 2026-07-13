/**
 * Deterministic "mechanism" models for the teaching animations.
 *
 * These functions compute — WITHOUT any timing measurement — exactly how much
 * work each comparator or exponentiation performs on a given input. They are the
 * causal core the live benchmarks only sample noisily: an early-exit compare
 * literally executes fewer instructions on a wrong-early guess, and
 * square-and-multiply literally performs one extra multiply per set exponent bit.
 *
 * Because the counts are exact and input-derived (not clock-derived), the
 * animations built on them always show the leak's cause, even when the browser's
 * coarsened timer hides the leak's effect in the live panels.
 */

export type ByteStatus = "match" | "mismatch" | "skipped" | "scanned";

export type CompareByteStep = {
  index: number;
  targetChar: string;
  guessChar: string;
  status: ByteStatus;
};

export type CompareTrace = {
  steps: CompareByteStep[];
  /** Byte-compare operations actually executed (the secret-dependent count). */
  operations: number;
  /** True when every executed byte matched and lengths agree. */
  equal: boolean;
  /** Index of the first mismatch, or -1 if the strings are equal. */
  firstMismatch: number;
};

const VISIBLE = "·"; // placeholder glyph for a space so the cell is never blank

function glyph(source: string, index: number): string {
  if (index >= source.length) {
    return "∅";
  }
  const ch = source[index];
  return ch === " " ? VISIBLE : ch;
}

/**
 * Model the VULNERABLE early-exit comparator. Walks left-to-right, marking each
 * byte match/mismatch, and STOPS at the first mismatch — every later byte is
 * "skipped" (never inspected). `operations` is therefore secret-dependent:
 * a guess wrong at byte 3 costs far fewer operations than one wrong at byte 20.
 */
export function traceVulnerableCompare(target: string, guess: string): CompareTrace {
  const maxLength = Math.max(target.length, guess.length);
  const steps: CompareByteStep[] = [];
  let operations = 0;
  let firstMismatch = -1;

  for (let i = 0; i < maxLength; i += 1) {
    if (firstMismatch !== -1) {
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "skipped" });
      continue;
    }
    operations += 1;
    const same = i < target.length && i < guess.length && target.charCodeAt(i) === guess.charCodeAt(i);
    if (same) {
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "match" });
    } else {
      firstMismatch = i;
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "mismatch" });
    }
  }

  const equal = firstMismatch === -1 && target.length === guess.length;
  return { steps, operations, equal, firstMismatch };
}

/**
 * Model the CONSTANT-TIME comparator. It inspects EVERY byte position regardless
 * of where the first difference is, accumulating a difference mask. `operations`
 * equals the full length every time — independent of the secret — so the running
 * count is flat across all guesses. That flat count IS the defense.
 */
export function traceConstantCompare(target: string, guess: string): CompareTrace {
  const maxLength = Math.max(target.length, guess.length);
  const steps: CompareByteStep[] = [];
  let diff = target.length ^ guess.length;
  let firstMismatch = -1;

  for (let i = 0; i < maxLength; i += 1) {
    const a = i < target.length ? target.charCodeAt(i) : 0;
    const b = i < guess.length ? guess.charCodeAt(i) : 0;
    const same = a === b;
    diff |= a ^ b;
    if (!same && firstMismatch === -1) {
      firstMismatch = i;
    }
    steps.push({
      index: i,
      targetChar: glyph(target, i),
      guessChar: glyph(guess, i),
      // Every byte is scanned; still colour matches vs the (scanned-anyway) diffs
      // so the learner sees it never bails out.
      status: same ? "match" : "scanned"
    });
  }

  return { steps, operations: maxLength, equal: diff === 0, firstMismatch };
}

/**
 * A modeled (NOT measured) cost curve for the vulnerable early-exit compare:
 * work is proportional to the number of correct leading bytes + 1 (the byte that
 * fails). This is the ideal signal the noisy live timer only approximates — it is
 * always labeled "modeled, not measured" in the UI so learners never mistake it
 * for a real measurement.
 */
export function modeledPrefixCost(target: string, prefixLen: number): number {
  const clamped = Math.max(0, Math.min(prefixLen, target.length));
  // +1 for the failing byte, unless the whole string matched.
  return clamped >= target.length ? target.length : clamped + 1;
}

/* ------------------------------------------------------------------ *
 * RSA square-and-multiply mechanism
 * ------------------------------------------------------------------ */

export type ExponentBitStep = {
  index: number;
  bit: 0 | 1;
  /** Naive square-and-multiply always squares; multiplies only on a 1-bit. */
  naiveSquares: number;
  naiveMultiplies: number;
  /** Montgomery ladder does one square AND one multiply every bit, always. */
  ladderSquares: number;
  ladderMultiplies: number;
};

export type ExponentTrace = {
  bits: (0 | 1)[];
  steps: ExponentBitStep[];
  naiveSquares: number;
  naiveMultiplies: number;
  ladderSquares: number;
  ladderMultiplies: number;
  /** Number of set bits — the naive multiply count equals this (the leak). */
  hammingWeight: number;
};

/** Big-endian bits of a non-negative integer, no leading zero (except for 0). */
export function bitsOf(value: number): (0 | 1)[] {
  if (value <= 0) {
    return [0];
  }
  return value
    .toString(2)
    .split("")
    .map((c) => (c === "1" ? 1 : 0));
}

/**
 * Model both exponentiation schedules over the exponent's bits. Naive
 * square-and-multiply performs an EXTRA multiply exactly on the 1-bits, so its
 * total multiply count equals the Hamming weight — that secret-dependent count is
 * the timing leak. The Montgomery ladder performs one square and one multiply on
 * EVERY bit, so its counts depend only on the bit LENGTH, never the bit values.
 */
export function traceExponent(value: number): ExponentTrace {
  const bits = bitsOf(value);
  const steps: ExponentBitStep[] = [];
  let naiveSquares = 0;
  let naiveMultiplies = 0;
  let ladderSquares = 0;
  let ladderMultiplies = 0;

  bits.forEach((bit, index) => {
    naiveSquares += 1;
    if (bit === 1) {
      naiveMultiplies += 1;
    }
    ladderSquares += 1;
    ladderMultiplies += 1;
    steps.push({
      index,
      bit,
      naiveSquares,
      naiveMultiplies,
      ladderSquares,
      ladderMultiplies
    });
  });

  return {
    bits,
    steps,
    naiveSquares,
    naiveMultiplies,
    ladderSquares,
    ladderMultiplies,
    hammingWeight: bits.filter((b) => b === 1).length
  };
}
