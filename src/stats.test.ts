import { describe, expect, it } from "vitest";
import { cohenD, mean, median, stdDev, trimmedMean } from "./stats";

describe("statistics helpers", () => {
  it("mean and median", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
  });

  it("trimmedMean discards outliers", () => {
    // 1000 is an outlier; trimming the extremes pulls the mean toward the cluster.
    const data = [10, 10, 11, 9, 10, 1000];
    expect(trimmedMean(data, 0.2)).toBeLessThan(mean(data));
  });

  it("stdDev of a constant series is zero", () => {
    expect(stdDev([5, 5, 5])).toBe(0);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  it("cohenD separates well-separated distributions", () => {
    const close = cohenD([1, 2, 3], [1, 2, 3]);
    const far = cohenD([1, 2, 3], [100, 101, 102]);
    expect(close).toBe(0);
    expect(far).toBeGreaterThan(2);
  });
});
