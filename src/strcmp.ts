export type ComparisonStats = {
  vulnerableSamples: number[];
  constantSamples: number[];
  vulnerableMean: number;
  constantMean: number;
  vulnerableStdDev: number;
  constantStdDev: number;
  prefixMatchLength: number;
  iterationsPerMode: number;
};

function stdDev(values: number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

export function vulnerableCompareStrings(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

export function constantTimeCompareStrings(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLength; i += 1) {
    const aCode = i < a.length ? a.charCodeAt(i) : 0;
    const bCode = i < b.length ? b.charCodeAt(i) : 0;
    diff |= aCode ^ bCode;
  }
  return diff === 0;
}

export function sharedPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return i;
    }
  }
  return length;
}

export function benchmarkStringComparisons(
  target: string,
  guess: string,
  totalIterations = 10000
): ComparisonStats {
  const buckets = 200;
  const loopsPerSample = Math.max(1, Math.floor(totalIterations / buckets));
  const vulnerableSamples: number[] = [];
  const constantSamples: number[] = [];

  performance.mark("strcmp-vuln-start");
  for (let sample = 0; sample < buckets; sample += 1) {
    const sampleStart = performance.now();
    for (let i = 0; i < loopsPerSample; i += 1) {
      vulnerableCompareStrings(target, guess);
    }
    const sampleEnd = performance.now();
    vulnerableSamples.push(sampleEnd - sampleStart);
  }
  performance.mark("strcmp-vuln-end");

  performance.mark("strcmp-ct-start");
  for (let sample = 0; sample < buckets; sample += 1) {
    const sampleStart = performance.now();
    for (let i = 0; i < loopsPerSample; i += 1) {
      constantTimeCompareStrings(target, guess);
    }
    const sampleEnd = performance.now();
    constantSamples.push(sampleEnd - sampleStart);
  }
  performance.mark("strcmp-ct-end");

  const vulnerableMean = vulnerableSamples.reduce((sum, value) => sum + value, 0) / vulnerableSamples.length;
  const constantMean = constantSamples.reduce((sum, value) => sum + value, 0) / constantSamples.length;

  return {
    vulnerableSamples,
    constantSamples,
    vulnerableMean,
    constantMean,
    vulnerableStdDev: stdDev(vulnerableSamples, vulnerableMean),
    constantStdDev: stdDev(constantSamples, constantMean),
    prefixMatchLength: sharedPrefixLength(target, guess),
    iterationsPerMode: loopsPerSample * buckets
  };
}
