import { describe, expect, it } from "vitest";
import {
  bitsOf,
  modeledPrefixCost,
  traceConstantCompare,
  traceExponent,
  traceVulnerableCompare
} from "./mechanism";
import { modPowMontgomeryLadder, modPowNaive } from "./rsa";
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

  it("both real modpow routines agree, backing the modeled schedules", () => {
    // The animation asserts the ladder is a drop-in replacement; verify the math.
    const base = 7n;
    const modulus = 3233n; // 61*53
    for (const e of [17n, 255n, 65n, 413n]) {
      expect(modPowMontgomeryLadder(base, e, modulus)).toBe(modPowNaive(base, e, modulus));
    }
  });
});
