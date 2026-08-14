import { describe, expect, it } from "vitest";
import {
  cacheVerdict,
  hmacVerdict,
  relativeGap,
  rsaVerdict,
  stringComparisonVerdict
} from "./verdict";

describe("relativeGap", () => {
  it("is zero for equal values and scales with difference", () => {
    expect(relativeGap(5, 5)).toBe(0);
    expect(relativeGap(2, 1)).toBeCloseTo(0.5, 5);
  });
});

describe("leak verdicts", () => {
  it("string comparison flags a growing prefix as a leak", () => {
    expect(stringComparisonVerdict(1, 2, 1, 1.01, 100).tone).toBe("leak");
    expect(stringComparisonVerdict(1, 1.01, 1, 1, 100).tone).toBe("inconclusive");
  });

  it("string comparison cannot claim a leak when the constant-time path drifted as much", () => {
    // The verdict used to receive only the vulnerable endpoints and still print
    // "while the constant-time path stayed flat" — a claim it had no evidence
    // for. A constant-time sweep that moved as much as the vulnerable one means
    // something moved BOTH lines, and that is not a leak finding.
    const drifted = stringComparisonVerdict(1, 2, 1, 2.2, 100);
    expect(drifted.tone).toBe("inconclusive");
    expect(drifted.label).toBe("Both paths drifted this run");
    // The leak branch reports the constant-time movement it measured rather
    // than asserting flatness it never checked.
    const leak = stringComparisonVerdict(1, 2, 1, 1.05, 100);
    expect(leak.tone).toBe("leak");
    expect(leak.detail).toContain("moved ~5%");
    expect(leak.detail).not.toMatch(/stayed flat/iu);
  });

  it("hmac flags a positive prefix slope larger than the constant-time slope", () => {
    expect(hmacVerdict(0.5, 0.0, 1, 100).tone).toBe("leak");
    expect(hmacVerdict(0.001, 0.0, 1, 100).tone).toBe("inconclusive");
    // a vulnerable slope no larger than the constant-time slope is not a clear leak
    expect(hmacVerdict(0.5, 0.6, 1, 100).tone).toBe("inconclusive");
  });

  it("rsa flags a bit-dependent naive gap over a uniform ladder", () => {
    expect(rsaVerdict(0.5, 0.0, 1, 100).tone).toBe("leak");
    expect(rsaVerdict(0.01, 0.0, 1, 100).tone).toBe("inconclusive");
  });

  it("cache flags uncached access measurably slower than cached", () => {
    expect(cacheVerdict(1, 2, 100).tone).toBe("leak");
    expect(cacheVerdict(1, 1.01, 100).tone).toBe("inconclusive");
    // cached slower than uncached is noise, never a leak
    expect(cacheVerdict(2, 1, 100).tone).toBe("inconclusive");
  });
});

describe("verdicts state their scope rather than claiming exploitability", () => {
  const all = [
    stringComparisonVerdict(1, 2, 1, 1.01, 512),
    stringComparisonVerdict(1, 1.01, 1, 1, 512),
    stringComparisonVerdict(1, 2, 1, 2.2, 512), // both paths drifted
    hmacVerdict(0.5, 0.0, 1, 512),
    hmacVerdict(0.001, 0.0, 1, 512),
    rsaVerdict(0.5, 0.0, 1, 512),
    rsaVerdict(0.01, 0.0, 1, 512),
    cacheVerdict(1, 2, 512),
    cacheVerdict(1, 1.01, 512)
  ];

  it("names the sample count it measured over, in every branch", () => {
    for (const v of all) {
      expect(v.detail, v.label).toContain("512 samples");
    }
  });

  it("never asserts the secret is recoverable from what this run measured", () => {
    // Each of these shipped at some point as an unqualified claim about a run
    // that only compared two means against a fixed ratio.
    const overclaims = [
      /an attacker can recover the secret/iu,
      /statistically it is still exploitable/iu,
      /— a forgery oracle/iu,
      /leaks the MAC\b/iu,
      // Shipped in the string leak branch while the function only received the
      // vulnerable endpoints: a flatness claim nothing had measured.
      /stayed flat/iu
    ];
    for (const v of all) {
      for (const pattern of overclaims) {
        expect(`${v.label} ${v.detail}`, `${v.label} / ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("does not read an unresolved signal as evidence of safety", () => {
    for (const v of all.filter((x) => x.tone === "inconclusive")) {
      expect(v.detail.toLowerCase(), v.label).toMatch(/not evidence|limit of the measurement|not about the channel/u);
    }
  });
});
