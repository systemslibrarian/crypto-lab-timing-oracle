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
    expect(stringComparisonVerdict(1, 2, 100).tone).toBe("leak");
    expect(stringComparisonVerdict(1, 1.01, 100).tone).toBe("inconclusive");
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
    stringComparisonVerdict(1, 2, 512),
    stringComparisonVerdict(1, 1.01, 512),
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
      /leaks the MAC\b/iu
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
