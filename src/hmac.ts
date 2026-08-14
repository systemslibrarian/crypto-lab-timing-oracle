const encoder = new TextEncoder();

export type HmacTimingPoint = {
  prefixBytes: number;
  vulnerableMean: number;
  constantMean: number;
};

export type HmacTimingStats = {
  points: HmacTimingPoint[];
  vulnerableSeries: number[];
  constantSeries: number[];
  expectedMacHex: string;
  providedMacHex: string;
  vulnerableUserCheckMs: number;
  constantUserCheckMs: number;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || /[^0-9a-f]/u.test(normalized)) {
    throw new Error("MAC must be valid lowercase or uppercase hex with even length.");
  }
  const output = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

function vulnerableVerifyBytes(expected: Uint8Array, candidate: Uint8Array): boolean {
  if (expected.length !== candidate.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== candidate[i]) {
      return false;
    }
  }
  return true;
}

function constantTimeVerifyBytes(expected: Uint8Array, candidate: Uint8Array): boolean {
  const maxLength = Math.max(expected.length, candidate.length);
  let diff = expected.length ^ candidate.length;
  for (let i = 0; i < maxLength; i += 1) {
    const a = i < expected.length ? expected[i] : 0;
    const b = i < candidate.length ? candidate[i] : 0;
    diff |= a ^ b;
  }
  return diff === 0;
}

async function importDemoHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode("crypto-lab-timing-oracle-demo-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacSha256(message: string): Promise<Uint8Array> {
  const key = await importDemoHmacKey();
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(mac);
}

function buildCandidateWithPrefix(expected: Uint8Array, prefixLength: number): Uint8Array {
  const candidate = crypto.getRandomValues(new Uint8Array(expected.length));
  for (let i = 0; i < Math.min(prefixLength, expected.length); i += 1) {
    candidate[i] = expected[i];
  }
  if (prefixLength < expected.length) {
    candidate[prefixLength] = expected[prefixLength] ^ 0xff;
  }
  return candidate;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function benchmarkHmacVerification(
  message: string,
  providedMacHex: string,
  iterations = 8000
): Promise<HmacTimingStats> {
  const expectedMac = await hmacSha256(message);
  const expectedMacHex = bytesToHex(expectedMac);

  // Malformed hex is surfaced, not swallowed. This used to fall back to an
  // all-zero MAC, so typing "nothex!!" produced a normal-looking run whose
  // reported providedMacHex was a value the user never entered, and the panel's
  // error region (and its "adjust forged MAC hex and retry" message) could never
  // be reached by any input.
  const provided = hexToBytes(providedMacHex);

  // A forged MAC of any other length is a different experiment. The vulnerable
  // verifier rejects a wrong-length candidate at its length gate without
  // inspecting a single byte, and the fixed-work verifier loops to the LONGER
  // length — so a short or long candidate measures a length oracle, silently,
  // under a chart captioned as the fixed-length prefix leak. HMAC-SHA-256 tags
  // are 32 bytes; this panel requires exactly that and names the rejection.
  if (provided.length !== expectedMac.length) {
    throw new Error(
      `Forged MAC must be exactly ${expectedMac.length * 2} hex characters ` +
        `(${expectedMac.length} bytes, the HMAC-SHA-256 tag length) — got ${provided.length} byte${provided.length === 1 ? "" : "s"}.`
    );
  }

  const userVulnerableStart = performance.now();
  vulnerableVerifyBytes(expectedMac, provided);
  const userVulnerableEnd = performance.now();

  const userConstantStart = performance.now();
  constantTimeVerifyBytes(expectedMac, provided);
  const userConstantEnd = performance.now();

  const prefixes = [0, 4, 8, 12, 16];
  const loopsPerPrefix = Math.max(1, Math.floor(iterations / prefixes.length));
  const points: HmacTimingPoint[] = [];
  const vulnerableSeries: number[] = [];
  const constantSeries: number[] = [];

  for (const prefix of prefixes) {
    const candidate = buildCandidateWithPrefix(expectedMac, prefix);
    const vulnerableSamples: number[] = [];
    const constantSamples: number[] = [];

    for (let i = 0; i < 60; i += 1) {
      const sampleStart = performance.now();
      for (let j = 0; j < loopsPerPrefix; j += 1) {
        vulnerableVerifyBytes(expectedMac, candidate);
      }
      const sampleEnd = performance.now();
      const value = sampleEnd - sampleStart;
      vulnerableSamples.push(value);
      vulnerableSeries.push(value);
    }

    for (let i = 0; i < 60; i += 1) {
      const sampleStart = performance.now();
      for (let j = 0; j < loopsPerPrefix; j += 1) {
        constantTimeVerifyBytes(expectedMac, candidate);
      }
      const sampleEnd = performance.now();
      const value = sampleEnd - sampleStart;
      constantSamples.push(value);
      constantSeries.push(value);
    }

    points.push({
      prefixBytes: prefix,
      vulnerableMean: mean(vulnerableSamples),
      constantMean: mean(constantSamples)
    });
  }

  return {
    points,
    vulnerableSeries,
    constantSeries,
    expectedMacHex,
    providedMacHex: bytesToHex(provided),
    vulnerableUserCheckMs: userVulnerableEnd - userVulnerableStart,
    constantUserCheckMs: userConstantEnd - userConstantStart
  };
}
