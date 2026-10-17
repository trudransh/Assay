import { describe, expect, it } from "vitest";
import { hostKeyForAgent, hostKeyForDirect, hostKeyForEndpoint, hostKeyOf } from "../src/hostKey.js";

// Expected values come from `cast keccak "<string>"`.
describe("host keys (D21)", () => {
  it("hashes the ERC-8004 identity string", () => {
    expect(hostKeyForAgent(10143n, 1962n)).toBe("0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c");
    expect(hostKeyForAgent(31337, 1)).toBe("0x953e377eb45180111dd33cc3efda7fb7589dee86860917248d690c1472d5ba1e");
  });

  it("hashes the endpoint tag with the openrouter: prefix", () => {
    expect(hostKeyForEndpoint("qwen/qwen3.8-27b:free@chutes")).toBe(
      "0xf684de88c6aa5f740fbbca95bd9c39eff5d015695548bdd967a92ac38d80d1db",
    );
  });

  it("rejects non-integer ids", () => {
    expect(() => hostKeyForAgent(1.5, 1)).toThrow();
  });

  it("hostKeyForDirect matches cast keccak and harness/export_grade.py", () => {
    expect(hostKeyForDirect("generativelanguage.googleapis.com")).toBe(
      "0xd0fe1e8708e22bc3fe3b101f9ab21a41052eb11b27d4d994f91cccca881927c7",
    );
  });
});

describe("hostKeyOf", () => {
  it("reads every convention as its preimage, and a bytes32 as is", () => {
    expect(hostKeyOf("erc8004:143:10278")).toBe(hostKeyForAgent(143, 10278));
    expect(hostKeyOf("openrouter:z-ai/fp8")).toBe(hostKeyForEndpoint("z-ai/fp8"));
    expect(hostKeyOf("direct:generativelanguage.googleapis.com")).toBe(hostKeyForDirect("generativelanguage.googleapis.com"));
    expect(hostKeyOf(`0x${"AB".repeat(32)}`)).toBe(`0x${"ab".repeat(32)}`);
  });

  it("returns null for anything else", () => {
    for (const bad of ["10278", "z-ai/fp8", "erc8004:143", "0x1234", ""]) expect(hostKeyOf(bad)).toBeNull();
  });
});
