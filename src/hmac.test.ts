import { describe, expect, it } from "vitest";
import { benchmarkHmacVerification, hexToBytes } from "./hmac";

describe("hexToBytes", () => {
  it("parses valid lowercase and uppercase hex", () => {
    expect(Array.from(hexToBytes("00ff10"))).toEqual([0, 255, 16]);
    expect(Array.from(hexToBytes("00FF10"))).toEqual([0, 255, 16]);
    expect(Array.from(hexToBytes("  0a0B  "))).toEqual([10, 11]);
  });

  it("rejects malformed hex", () => {
    expect(() => hexToBytes("")).toThrow();
    expect(() => hexToBytes("abc")).toThrow(); // odd length
    expect(() => hexToBytes("zz")).toThrow(); // non-hex
    expect(() => hexToBytes("0x10")).toThrow();
  });
});

describe("benchmarkHmacVerification", () => {
  it("rejects a malformed forged MAC instead of silently substituting zeros", async () => {
    // The panel renders an error region and a "adjust forged MAC hex and retry"
    // message. Swallowing the parse error made both unreachable and reported a
    // providedMacHex the user never typed.
    await expect(benchmarkHmacVerification("hello", "nothex!!", 20)).rejects.toThrow(/hex/u);
  });

  it("rejects a well-formed forged MAC of the wrong length before benchmarking", async () => {
    // Any length other than the 32-byte tag turns the run into a length-oracle
    // measurement — the vulnerable verifier rejects at its length gate without
    // inspecting a byte — while the chart still claims to plot prefix bytes.
    await expect(benchmarkHmacVerification("hello", "00".repeat(31), 20)).rejects.toThrow(/exactly 64 hex/u);
    await expect(benchmarkHmacVerification("hello", "00".repeat(33), 20)).rejects.toThrow(/exactly 64 hex/u);
    await expect(benchmarkHmacVerification("hello", "ab", 20)).rejects.toThrow(/got 1 byte\./u);
  });

  it("reports the MAC it actually verified for well-formed input", async () => {
    const stats = await benchmarkHmacVerification("hello", "00".repeat(32), 20);
    expect(stats.providedMacHex).toBe("00".repeat(32));
    expect(stats.expectedMacHex).toMatch(/^[0-9a-f]{64}$/u);
    expect(stats.points.map((p) => p.prefixBytes)).toEqual([0, 4, 8, 12, 16]);
  });
});
