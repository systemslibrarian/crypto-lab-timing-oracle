import { describe, expect, it } from "vitest";
import { hexToBytes } from "./hmac";

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
