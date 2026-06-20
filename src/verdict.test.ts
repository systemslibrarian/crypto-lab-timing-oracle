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
    expect(stringComparisonVerdict(1, 2).tone).toBe("leak");
    expect(stringComparisonVerdict(1, 1.01).tone).toBe("inconclusive");
  });

  it("hmac flags a positive prefix slope larger than the constant-time slope", () => {
    expect(hmacVerdict(0.5, 0.0, 1).tone).toBe("leak");
    expect(hmacVerdict(0.001, 0.0, 1).tone).toBe("inconclusive");
    // a vulnerable slope no larger than the constant-time slope is not a clear leak
    expect(hmacVerdict(0.5, 0.6, 1).tone).toBe("inconclusive");
  });

  it("rsa flags a bit-dependent naive gap over a uniform ladder", () => {
    expect(rsaVerdict(0.5, 0.0, 1).tone).toBe("leak");
    expect(rsaVerdict(0.01, 0.0, 1).tone).toBe("inconclusive");
  });

  it("cache flags uncached access measurably slower than cached", () => {
    expect(cacheVerdict(1, 2).tone).toBe("leak");
    expect(cacheVerdict(1, 1.01).tone).toBe("inconclusive");
    // cached slower than uncached is noise, never a leak
    expect(cacheVerdict(2, 1).tone).toBe("inconclusive");
  });
});
