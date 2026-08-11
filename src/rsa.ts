export type RsaTimingStats = {
  keyDescription: string;
  selectedBitIndex: number;
  naiveBit0Samples: number[];
  naiveBit1Samples: number[];
  ladderBit0Samples: number[];
  ladderBit1Samples: number[];
  naiveBit0Mean: number;
  naiveBit1Mean: number;
  ladderBit0Mean: number;
  ladderBit1Mean: number;
  webCryptoSignMeanMs: number;
  /** Low bits of the actual generated private exponent d, for the bit-schedule animation. */
  exponentLowBits: number;
};

type ToyRsaKeypair = {
  n: bigint;
  e: bigint;
  d: bigint;
  p: bigint;
  q: bigint;
};

export function modPowNaive(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  const current = base % modulus;
  const bitLength = exponent.toString(2).length;

  for (let index = bitLength - 1; index >= 0; index -= 1) {
    result = (result * result) % modulus;
    const bit = (exponent >> BigInt(index)) & 1n;
    if (bit === 1n) {
      result = (result * current) % modulus;
    }
  }

  return result;
}

/**
 * Branchless conditional swap. `swap` must be 0n or 1n; multiplying the XOR
 * difference by it yields either the difference or zero, so the exchange happens
 * with no data-dependent control flow.
 */
export function cswap(swap: bigint, a: bigint, b: bigint): [bigint, bigint] {
  const delta = (a ^ b) * swap;
  return [a ^ delta, b ^ delta];
}

/**
 * Montgomery ladder — EXACTLY one multiply and one square per exponent bit,
 * which is what the page and the mechanism animation both claim it does.
 *
 * The previous implementation selected arithmetically instead of swapping, so
 * it computed r0*r1, r0*r0 AND r1*r1 — three modular multiplications per bit,
 * not two. Its operation count was still bit-independent (the taught property
 * held), but "one square and one multiply on every bit" described an algorithm
 * the benchmarked code was not running, and the modeled counts in mechanism.ts
 * (one of each per bit) did not match the routine the histogram timed.
 *
 * Invariant: r1 = r0 * base, i.e. r0 = base^k and r1 = base^(k+1).
 */
export function modPowMontgomeryLadder(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let r0 = 1n;
  let r1 = base % modulus;
  const bitLength = exponent.toString(2).length;

  for (let index = bitLength - 1; index >= 0; index -= 1) {
    const bit = (exponent >> BigInt(index)) & 1n;
    [r0, r1] = cswap(bit, r0, r1);
    r1 = (r0 * r1) % modulus; // the multiply
    r0 = (r0 * r0) % modulus; // the square
    [r0, r1] = cswap(bit, r0, r1);
  }

  return r0;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) {
    return [a, 1n, 0n];
  }
  const [g, x1, y1] = extendedGcd(b, a % b);
  return [g, y1, x1 - (a / b) * y1];
}

function modInverse(a: bigint, modulus: bigint): bigint {
  const [g, x] = extendedGcd(a, modulus);
  if (g !== 1n) {
    throw new Error("No modular inverse");
  }
  return ((x % modulus) + modulus) % modulus;
}

function isPrime(n: bigint): boolean {
  if (n < 2n) {
    return false;
  }
  if (n === 2n || n === 3n) {
    return true;
  }
  if (n % 2n === 0n) {
    return false;
  }
  for (let i = 3n; i * i <= n; i += 2n) {
    if (n % i === 0n) {
      return false;
    }
  }
  return true;
}

/** Uniform integer in [0, bound) from the platform CSPRNG (never Math.random). */
function randomBelow(bound: number): number {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / bound) * bound; // reject to avoid modulo bias
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) {
      return buffer[0] % bound;
    }
  }
}

function randomPrime(min = 200n, max = 500n): bigint {
  for (let attempts = 0; attempts < 5000; attempts += 1) {
    const candidate = BigInt(randomBelow(Number(max - min))) + min;
    const odd = candidate % 2n === 0n ? candidate + 1n : candidate;
    if (isPrime(odd)) {
      return odd;
    }
  }
  throw new Error("Unable to generate prime for toy RSA");
}

/**
 * Width of the private-exponent window the mechanism animation renders. The
 * animation pads to exactly this many bits, leading zeros included, so the
 * ladder's operation count is constant across runs — which is the property the
 * panel's caption claims for it.
 */
export const EXPONENT_WINDOW_BITS = 10;

function generateToyRsaKeypair(): ToyRsaKeypair {
  // Regenerate primes until a valid public exponent exists. Each attempt tries a
  // range of standard exponents constrained to e < phi (textbook RSA), so the
  // function does not throw on unlucky prime pairs.
  const candidates = [65537n, 257n, 17n, 5n, 3n];
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const p = randomPrime();
    let q = randomPrime();
    while (q === p) {
      q = randomPrime();
    }
    const n = p * q;
    const phi = (p - 1n) * (q - 1n);
    for (const e of candidates) {
      if (e < phi && gcd(e, phi) === 1n) {
        return { n, e, d: modInverse(e, phi), p, q };
      }
    }
  }
  throw new Error("Could not generate toy RSA key");
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function benchmarkWebCryptoRsaSign(samples = 24): Promise<number> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 1024,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );

  const message = new TextEncoder().encode("timing-oracle-rsa-webcrypto-sample");
  const samplesMs: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, keyPair.privateKey, message);
    const end = performance.now();
    samplesMs.push(end - start);
  }
  return mean(samplesMs);
}

export async function benchmarkRsaTiming(samples = 140): Promise<RsaTimingStats> {
  const key = generateToyRsaKeypair();
  const base = 12345n % key.n;
  const exponentBits = key.d.toString(2).length;
  const selectedBitIndex = Math.max(1, Math.min(8, exponentBits - 2));

  const bitMask = 1n << BigInt(selectedBitIndex);
  const dBit0 = key.d & ~bitMask;
  const dBit1 = key.d | bitMask;

  const naiveBit0Samples: number[] = [];
  const naiveBit1Samples: number[] = [];
  const ladderBit0Samples: number[] = [];
  const ladderBit1Samples: number[] = [];

  const loopsPerSample = 240;
  for (let i = 0; i < samples; i += 1) {
    const n0Start = performance.now();
    for (let j = 0; j < loopsPerSample; j += 1) {
      modPowNaive(base, dBit0, key.n);
    }
    const n0End = performance.now();
    naiveBit0Samples.push(n0End - n0Start);

    const n1Start = performance.now();
    for (let j = 0; j < loopsPerSample; j += 1) {
      modPowNaive(base, dBit1, key.n);
    }
    const n1End = performance.now();
    naiveBit1Samples.push(n1End - n1Start);

    const l0Start = performance.now();
    for (let j = 0; j < loopsPerSample; j += 1) {
      modPowMontgomeryLadder(base, dBit0, key.n);
    }
    const l0End = performance.now();
    ladderBit0Samples.push(l0End - l0Start);

    const l1Start = performance.now();
    for (let j = 0; j < loopsPerSample; j += 1) {
      modPowMontgomeryLadder(base, dBit1, key.n);
    }
    const l1End = performance.now();
    ladderBit1Samples.push(l1End - l1Start);
  }

  // Actually check the round trip rather than printing its output and calling
  // that a "check": encrypt with e, decrypt with d, and compare to the input.
  // The ladder is included so the two exponentiation routines the panel times
  // are both shown to be computing the same function.
  const sanityA = modPowNaive(base, key.e, key.n);
  const sanityB = modPowNaive(sanityA, key.d, key.n);
  const sanityLadder = modPowMontgomeryLadder(sanityA, key.d, key.n);
  const roundTripOk = sanityB === base && sanityLadder === base;
  const keyDescription =
    `Toy RSA key: p=${key.p}, q=${key.q}, n=${key.n}, e=${key.e}, d bits=${exponentBits}, ` +
    `encrypt-then-decrypt round trip=${roundTripOk ? "PASS" : "FAIL"} (naive and ladder both recover ${base})`;
  const webCryptoSignMeanMs = await benchmarkWebCryptoRsaSign();
  // Low 10 bits of the real private exponent, so the animation shows the actual
  // generated secret's schedule (not a canned pattern). Kept small so the row of
  // squares fits and steps at a watchable pace.
  const exponentLowBits = Number(key.d & ((1n << BigInt(EXPONENT_WINDOW_BITS)) - 1n));

  return {
    keyDescription,
    selectedBitIndex,
    naiveBit0Samples,
    naiveBit1Samples,
    ladderBit0Samples,
    ladderBit1Samples,
    naiveBit0Mean: mean(naiveBit0Samples),
    naiveBit1Mean: mean(naiveBit1Samples),
    ladderBit0Mean: mean(ladderBit0Samples),
    ladderBit1Mean: mean(ladderBit1Samples),
    webCryptoSignMeanMs,
    exponentLowBits
  };
}
