import { describe, expect, it } from "vitest";
import {
  constantTimeCompareStrings,
  sharedPrefixLength,
  vulnerableCompareStrings
} from "./strcmp";

describe("string comparison primitives", () => {
  it("both comparators agree on equality", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["a", "a"],
      ["abc", "abc"],
      ["abc", "abd"],
      ["abc", "ab"],
      ["abc", "abcd"],
      ["timing-oracle", "timing-oracle"]
    ];
    for (const [a, b] of cases) {
      expect(constantTimeCompareStrings(a, b)).toBe(vulnerableCompareStrings(a, b));
      expect(vulnerableCompareStrings(a, b)).toBe(a === b);
    }
  });

  it("constant-time compare rejects differing lengths", () => {
    expect(constantTimeCompareStrings("secret", "secret-extra")).toBe(false);
    expect(constantTimeCompareStrings("secret-extra", "secret")).toBe(false);
  });

  it("shared prefix length counts matching leading characters", () => {
    expect(sharedPrefixLength("abcdef", "abcxyz")).toBe(3);
    expect(sharedPrefixLength("abc", "abc")).toBe(3);
    expect(sharedPrefixLength("abc", "xyz")).toBe(0);
    expect(sharedPrefixLength("abc", "ab")).toBe(2);
    expect(sharedPrefixLength("", "anything")).toBe(0);
  });
});
