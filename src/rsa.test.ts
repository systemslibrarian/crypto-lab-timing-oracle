import { describe, expect, it } from "vitest";
import { modPowMontgomeryLadder, modPowNaive } from "./rsa";

/** Independent reference: right-to-left square-and-multiply. */
function refModPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % modulus;
    }
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** Deterministic LCG so the test is reproducible without Math.random. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("modular exponentiation", () => {
  it("naive and Montgomery ladder both match a reference across random inputs", () => {
    const rng = makeRng(0x9e3779b9);
    for (let i = 0; i < 2000; i += 1) {
      const modulus = BigInt(3 + Math.floor(rng() * 100000)) | 1n; // odd, > 1
      const base = BigInt(Math.floor(rng() * 1_000_000));
      const exponent = BigInt(Math.floor(rng() * 65537));
      const expected = refModPow(base, exponent, modulus);
      expect(modPowNaive(base, exponent, modulus)).toBe(expected);
      expect(modPowMontgomeryLadder(base, exponent, modulus)).toBe(expected);
    }
  });

  it("handles the exponent edge cases (0 and 1)", () => {
    const m = 97n;
    expect(modPowNaive(5n, 0n, m)).toBe(1n);
    expect(modPowMontgomeryLadder(5n, 0n, m)).toBe(1n);
    expect(modPowNaive(5n, 1n, m)).toBe(5n);
    expect(modPowMontgomeryLadder(5n, 1n, m)).toBe(5n);
  });

  it("supports an RSA encrypt/decrypt round trip", () => {
    // n = 61 * 53, e = 17, d = 2753 (classic textbook key).
    const n = 3233n;
    const e = 17n;
    const d = 2753n;
    for (const message of [0n, 1n, 42n, 123n, 3232n]) {
      const cipher = modPowMontgomeryLadder(message, e, n);
      expect(modPowMontgomeryLadder(cipher, d, n)).toBe(message % n);
    }
  });
});
