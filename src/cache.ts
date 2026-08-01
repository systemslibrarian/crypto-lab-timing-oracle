/**
 * Only what this benchmark actually measures.
 *
 * This type used to also carry l1EstimateNs / l2EstimateNs / l3EstimateNs /
 * dramEstimateNs — hardcoded 1/4/12/80 returned from a function named
 * `benchmarkCacheTiming`, which the UI then wrote into the L1–DRAM cells after
 * the user pressed "Measure". The numbers were never computed from anything, so
 * a field name ending in "Estimate" coming out of a benchmark was a claim the
 * code did not support. The ladder is a fixed reference diagram and now lives
 * only in the markup that says so.
 */
export type CacheTimingStats = {
  cachedSamples: number[];
  uncachedSamples: number[];
  cachedMean: number;
  uncachedMean: number;
};

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function touchArray(array: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < array.length; i += 16) {
    sum ^= array[i];
  }
  return sum;
}

export function benchmarkCacheTiming(samples = 160): CacheTimingStats {
  const hot = new Uint32Array(16 * 1024);
  const eviction = new Uint32Array(2 * 1024 * 1024);
  for (let i = 0; i < hot.length; i += 1) {
    hot[i] = i ^ 0xabcd;
  }
  for (let i = 0; i < eviction.length; i += 1) {
    eviction[i] = (i * 2654435761) >>> 0;
  }

  const cachedSamples: number[] = [];
  const uncachedSamples: number[] = [];
  let sink = 0;

  for (let i = 0; i < samples; i += 1) {
    sink ^= touchArray(hot);

    const cachedStart = performance.now();
    for (let j = 0; j < 120; j += 1) {
      sink ^= hot[(j * 31) & (hot.length - 1)];
    }
    const cachedEnd = performance.now();
    cachedSamples.push(cachedEnd - cachedStart);

    sink ^= touchArray(eviction);

    const uncachedStart = performance.now();
    for (let j = 0; j < 120; j += 1) {
      sink ^= hot[(j * 31) & (hot.length - 1)];
    }
    const uncachedEnd = performance.now();
    uncachedSamples.push(uncachedEnd - uncachedStart);
  }

  void sink;

  return {
    cachedSamples,
    uncachedSamples,
    cachedMean: mean(cachedSamples),
    uncachedMean: mean(uncachedSamples)
  };
}
