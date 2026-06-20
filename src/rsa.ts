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

export function modPowMontgomeryLadder(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let r0 = 1n;
  let r1 = base % modulus;
  const bitLength = exponent.toString(2).length;

  for (let index = bitLength - 1; index >= 0; index -= 1) {
    const bit = (exponent >> BigInt(index)) & 1n;
    const t0 = (r0 * r1) % modulus;
    const t1 = (r0 * r0) % modulus;
    const t2 = (r1 * r1) % modulus;
    const inv = 1n - bit;
    r0 = (t0 * bit + t1 * inv) % modulus;
    r1 = (t2 * bit + t0 * inv) % modulus;
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

function randomPrime(min = 200n, max = 500n): bigint {
  for (let attempts = 0; attempts < 5000; attempts += 1) {
    const candidate = BigInt(Math.floor(Math.random() * Number(max - min))) + min;
    const odd = candidate % 2n === 0n ? candidate + 1n : candidate;
    if (isPrime(odd)) {
      return odd;
    }
  }
  throw new Error("Unable to generate prime for toy RSA");
}

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

  const sanityA = modPowNaive(base, key.e, key.n);
  const sanityB = modPowNaive(sanityA, key.d, key.n);
  const keyDescription = `Toy RSA key: p=${key.p}, q=${key.q}, n=${key.n}, e=${key.e}, d bits=${exponentBits}, decrypt check=${sanityB}`;
  const webCryptoSignMeanMs = await benchmarkWebCryptoRsaSign();

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
    webCryptoSignMeanMs
  };
}
