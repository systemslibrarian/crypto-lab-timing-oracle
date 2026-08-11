import { describe, expect, it } from "vitest";
import {
  bitsOf,
  modeledPrefixCost,
  traceConstantCompare,
  traceExponent,
  traceVulnerableCompare
} from "./mechanism";
import { EXPONENT_WINDOW_BITS, modPowMontgomeryLadder, modPowNaive } from "./rsa";
import { constantTimeCompareStrings, vulnerableCompareStrings } from "./strcmp";

describe("compare mechanism traces", () => {
  it("vulnerable trace agrees with the real comparator on equality", () => {
    const cases: Array<[string, string]> = [
      ["abc", "abc"],
      ["abc", "abd"],
      ["abc", "ab"],
      ["abc", "abcd"],
      ["timing-oracle", "timing-oracXe"]
    ];
    for (const [a, b] of cases) {
      expect(traceVulnerableCompare(a, b).equal).toBe(vulnerableCompareStrings(a, b));
      expect(traceConstantCompare(a, b).equal).toBe(constantTimeCompareStrings(a, b));
    }
  });

  it("vulnerable operations are secret-dependent: fewer when the mismatch is early", () => {
    const target = "abcdefgh";
    const early = traceVulnerableCompare(target, "aXcdefgh"); // wrong at index 1
    const late = traceVulnerableCompare(target, "abcdefgX"); // wrong at index 7
    expect(early.operations).toBeLessThan(late.operations);
    expect(early.firstMismatch).toBe(1);
    expect(late.firstMismatch).toBe(7);
  });

  it("vulnerable trace stops at the first mismatch (rest are skipped)", () => {
    const trace = traceVulnerableCompare("abcdef", "abXdef");
    expect(trace.operations).toBe(3); // a, b, then the failing X
    const skipped = trace.steps.filter((s) => s.status === "skipped");
    expect(skipped.length).toBe(3); // d, e, f never inspected
  });

  it("constant-time operations are flat: same count regardless of mismatch position", () => {
    const target = "abcdefgh";
    const early = traceConstantCompare(target, "aXcdefgh");
    const late = traceConstantCompare(target, "abcdefgX");
    expect(early.operations).toBe(target.length);
    expect(late.operations).toBe(target.length);
    expect(early.operations).toBe(late.operations);
    expect(early.steps.every((s) => s.status !== "skipped")).toBe(true);
  });

  /**
   * The panel's own words: "counts character checks — no timer, so it is exact
   * every run." Exact means exact, including on the inputs the older tests
   * avoided. Every `operations` assertion above uses an equal-length pair — the
   * one case where the count happened to be right — while the unequal-length
   * pairs appear only in the `.equal` test, which checks the boolean and not the
   * count.
   *
   * The real comparator opens with `if (a.length !== b.length) return false;`
   * and so executes ZERO character comparisons on a length mismatch. Across a
   * 124-guess corpus reachable by editing the shipped defaults, 98 differed in
   * length and every one was overstated; guessing the secret minus its final
   * character showed "25 character checks" for a comparator that ran none.
   */
  it("vulnerable operations equal what the real comparator executes, including on unequal lengths", () => {
    /** Instrumented twin of strcmp.ts vulnerableCompareStrings. */
    const realOps = (a: string, b: string): number => {
      let ops = 0;
      if (a.length !== b.length) {
        return ops; // the real function returns here, before the loop
      }
      for (let i = 0; i < a.length; i += 1) {
        ops += 1;
        if (a.charCodeAt(i) !== b.charCodeAt(i)) {
          return ops;
        }
      }
      return ops;
    };

    const target = "timing-oracle-demo-secret";
    const guesses: string[] = [];
    // Truncations, deletions, insertions — all reachable with one keystroke.
    for (let n = 0; n <= target.length; n += 1) {
      guesses.push(target.slice(0, n));
    }
    for (let i = 0; i < target.length; i += 1) {
      guesses.push(target.slice(0, i) + target.slice(i + 1));
      guesses.push(target.slice(0, i) + "z" + target.slice(i));
      guesses.push(target.slice(0, i) + "z" + target.slice(i + 1)); // equal-length control
    }

    let unequalLength = 0;
    let equalLength = 0;
    for (const guess of guesses) {
      if (guess.length === target.length) {
        equalLength += 1;
      } else {
        unequalLength += 1;
      }
      expect(
        traceVulnerableCompare(target, guess).operations,
        `guess "${guess}" (len ${guess.length} vs ${target.length})`
      ).toBe(realOps(target, guess));
      expect(traceVulnerableCompare(target, guess).equal).toBe(vulnerableCompareStrings(target, guess));
    }

    // Neither half of the corpus may be empty, or this passes vacuously.
    expect(unequalLength, "the corpus must exercise unequal lengths").toBeGreaterThan(50);
    expect(equalLength, "the corpus must exercise equal lengths too").toBeGreaterThan(10);
  });

  it("a length mismatch is reported as a length gate, not as a walk that never happened", () => {
    const target = "abcdefgh";
    // A proper prefix of the secret: the most interesting near-miss there is.
    const gated = traceVulnerableCompare(target, "abcdefg");
    expect(gated.lengthGate).toBe(true);
    expect(gated.operations, "the loop was never entered").toBe(0);
    expect(gated.firstMismatch, "there is no mismatch to point at").toBe(-1);
    expect(gated.equal).toBe(false);
    expect(
      gated.steps.every((s) => s.status === "skipped"),
      "every position is uninspected"
    ).toBe(true);
    expect(gated.steps.length, "the row still shows the full width").toBe(target.length);

    // The constant-time path has no such gate: it folds the length into the mask
    // and scans every position, so its count is flat across both cases.
    const cGated = traceConstantCompare(target, "abcdefg");
    const cEqual = traceConstantCompare(target, "abcdefgX");
    expect(cGated.lengthGate).toBe(false);
    expect(cGated.operations).toBe(target.length);
    expect(cEqual.operations).toBe(target.length);
    expect(cGated.operations).toBe(cEqual.operations);
  });

  it("modeled prefix cost rises by one per correct leading byte", () => {
    const target = "secret";
    expect(modeledPrefixCost(target, 0)).toBe(1);
    expect(modeledPrefixCost(target, 3)).toBe(4);
    expect(modeledPrefixCost(target, target.length)).toBe(target.length);
    // Strictly increasing across the sweep.
    for (let i = 1; i <= target.length; i += 1) {
      expect(modeledPrefixCost(target, i)).toBeGreaterThanOrEqual(modeledPrefixCost(target, i - 1));
    }
  });
});

describe("exponent mechanism traces", () => {
  it("bitsOf is big-endian with no leading zeros", () => {
    expect(bitsOf(0)).toEqual([0]);
    expect(bitsOf(1)).toEqual([1]);
    expect(bitsOf(5)).toEqual([1, 0, 1]);
    expect(bitsOf(255)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("naive multiply count equals the Hamming weight (the leak)", () => {
    for (const value of [3, 5, 17, 255, 170, 12345]) {
      const trace = traceExponent(value);
      expect(trace.naiveMultiplies).toBe(trace.hammingWeight);
      // Squares run once per bit for both schedules.
      expect(trace.naiveSquares).toBe(trace.bits.length);
      expect(trace.ladderSquares).toBe(trace.bits.length);
    }
  });

  it("ladder operation counts depend only on bit length, never bit values", () => {
    // Same length, different Hamming weight -> ladder counts identical, naive differ.
    const a = traceExponent(0b10000000); // weight 1
    const b = traceExponent(0b11111111); // weight 8
    expect(a.bits.length).toBe(b.bits.length);
    expect(a.ladderMultiplies).toBe(b.ladderMultiplies);
    expect(a.ladderSquares).toBe(b.ladderSquares);
    expect(a.naiveMultiplies).not.toBe(b.naiveMultiplies);
  });

  /**
   * The test above picks 0b10000000 and 0b11111111 — both with the top bit set,
   * which is the only case where bitsOf() preserves the width. The panel renders
   * a FIXED window of the private exponent (d & 0x3ff) and says beneath it that
   * the ladder does one square and one multiply per bit "no matter the bit
   * values". Stripping leading zeros made the rendered width, and so the ladder
   * tally, a function of the top bit: sampling the window uniformly, 1027 of
   * 2000 draws rendered fewer than 10 positions and the on-screen ladder tally
   * ranged over all ten values from 1 to 10.
   *
   * Sweep the ENTIRE window rather than two hand-picked values.
   */
  it("at a fixed width the ladder tally is constant over every value the window can hold", () => {
    const width = EXPONENT_WINDOW_BITS;
    const ladderMultiplies = new Set<number>();
    const ladderSquares = new Set<number>();
    const naiveMultiplies = new Set<number>();
    const widths = new Set<number>();
    let checked = 0;

    for (let value = 0; value < 2 ** width; value += 1) {
      const trace = traceExponent(value, width);
      widths.add(trace.bits.length);
      ladderMultiplies.add(trace.ladderMultiplies);
      ladderSquares.add(trace.ladderSquares);
      naiveMultiplies.add(trace.naiveMultiplies);
      // The leak itself, restated per value.
      expect(trace.naiveMultiplies).toBe(trace.hammingWeight);
      checked += 1;
    }

    expect(checked, "the whole window must be swept").toBe(2 ** width);
    expect([...widths], "every value renders the same number of positions").toEqual([width]);
    expect([...ladderMultiplies], "the ladder multiply count must not move").toEqual([width]);
    expect([...ladderSquares], "nor the ladder square count").toEqual([width]);
    // And the contrast must be real: if the naive count were also constant there
    // would be nothing for the panel to teach.
    expect(
      naiveMultiplies.size,
      "the naive count must vary with the secret — that is the leak"
    ).toBeGreaterThan(1);
    expect(naiveMultiplies.size).toBe(width + 1); // Hamming weights 0..width
  });

  it("both real modpow routines agree, backing the modeled schedules", () => {
    // The animation asserts the ladder is a drop-in replacement; verify the math.
    const base = 7n;
    const modulus = 3233n; // 61*53
    for (const e of [17n, 255n, 65n, 413n]) {
      expect(modPowMontgomeryLadder(base, e, modulus)).toBe(modPowNaive(base, e, modulus));
    }
  });
});
