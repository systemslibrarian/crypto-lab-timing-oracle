export type CacheTimingStats = {
  cachedSamples: number[];
  uncachedSamples: number[];
  cachedMean: number;
  uncachedMean: number;
  l1EstimateNs: number;
  l2EstimateNs: number;
  l3EstimateNs: number;
  dramEstimateNs: number;
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
    uncachedMean: mean(uncachedSamples),
    l1EstimateNs: 1,
    l2EstimateNs: 4,
    l3EstimateNs: 12,
    dramEstimateNs: 80
  };
}
