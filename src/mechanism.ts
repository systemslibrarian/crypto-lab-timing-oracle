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
  /**
   * True when the comparator returned on its length check without entering the
   * compare loop. Only the vulnerable comparator has this exit; the
   * constant-time one folds the length into the same difference mask and scans
   * every position anyway, so it is always false there.
   */
  lengthGate: boolean;
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

  // The real comparator (src/strcmp.ts) opens with `if (a.length !== b.length)
  // return false;` — so on a length mismatch it executes ZERO character
  // comparisons. This model used to walk the string anyway and report the count
  // it would have run had the lengths matched. Across a corpus of 124 guesses
  // reachable by editing the shipped defaults, 98 of them differed in length and
  // every one was overstated; the worst case was the pedagogically interesting
  // one — guessing the secret minus its last character showed "25 byte checks"
  // for a comparator that ran none. The panel calls itself "exact every run".
  if (target.length !== guess.length) {
    for (let i = 0; i < maxLength; i += 1) {
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "skipped" });
    }
    return { steps, operations: 0, equal: false, firstMismatch: -1, lengthGate: true };
  }

  let operations = 0;
  let firstMismatch = -1;

  for (let i = 0; i < maxLength; i += 1) {
    if (firstMismatch !== -1) {
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "skipped" });
      continue;
    }
    operations += 1;
    const same = target.charCodeAt(i) === guess.charCodeAt(i);
    if (same) {
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "match" });
    } else {
      firstMismatch = i;
      steps.push({ index: i, targetChar: glyph(target, i), guessChar: glyph(guess, i), status: "mismatch" });
    }
  }

  const equal = firstMismatch === -1;
  return { steps, operations, equal, firstMismatch, lengthGate: false };
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

  // No length gate here: the length difference goes into `diff` and every
  // position is scanned regardless. That is precisely why this path leaks
  // neither the secret's contents nor its length.
  return { steps, operations: maxLength, equal: diff === 0, firstMismatch, lengthGate: false };
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
 * Big-endian bits at a FIXED width, leading zeros preserved.
 *
 * The RSA panel renders a fixed-size window of the private exponent and says
 * beneath it that the ladder performs one square and one multiply per bit "no
 * matter the bit values". Feeding it `bitsOf()` broke exactly that claim:
 * stripping leading zeros makes the rendered width — and so the ladder tally —
 * a function of the top bit's value. Sampling the low-10-bit window uniformly,
 * 1027 of 2000 draws rendered fewer than 10 positions, and the ladder tally on
 * screen ranged over all ten values from 1 to 10. Padding pins the ladder at a
 * constant while the naive count still tracks the Hamming weight, which is the
 * whole contrast the panel exists to draw.
 */
export function bitsOfWidth(value: number, width: number): (0 | 1)[] {
  const clamped = Math.max(0, Math.floor(value));
  const bits: (0 | 1)[] = [];
  for (let i = width - 1; i >= 0; i -= 1) {
    bits.push(((clamped >> i) & 1) === 1 ? 1 : 0);
  }
  return bits;
}

/**
 * Model both exponentiation schedules over the exponent's bits. Naive
 * square-and-multiply performs an EXTRA multiply exactly on the 1-bits, so its
 * total multiply count equals the Hamming weight — that secret-dependent count is
 * the timing leak. The Montgomery ladder performs one square and one multiply on
 * EVERY bit, so its counts depend only on the bit LENGTH, never the bit values.
 */
export function traceExponent(value: number, width?: number): ExponentTrace {
  const bits = width === undefined ? bitsOf(value) : bitsOfWidth(value, width);
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
