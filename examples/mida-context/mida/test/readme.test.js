import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const lower = readme.toLowerCase();

describe("README wording", () => {
  it("carries the required plain words", () => {
    for (const needle of [
      "Monad testnet",
      "not audited",
      "ciphertext",
      "which weights ran",
      "trusted",
      "forward-only",
      "is not consulted",
      // the new contract
      "checkRecord",
      "export",
      "revoke",
      "ReceiptAnchor",
      "RPC",
    ]) {
      expect(readme, `missing: ${needle}`).toContain(needle);
    }
  });

  it("never says the forbidden words", () => {
    for (const bad of ["stored on-chain", "ChatGPT", "integrated Mida"]) {
      expect(readme, `forbidden: ${bad}`).not.toContain(bad);
    }
    expect(readme).not.toMatch(/\$\d/);
    expect(lower).not.toContain("delete");
    expect(lower).not.toContain(" free ");
    expect(lower).not.toMatch(/\bintegrated\b/);
  });

  it("has the sections in order", () => {
    const heads = [
      "What this is",
      "How it works",
      "Setup for the owner",
      "Run",
      "Revoke",
      "Decision rules",
      "The record",
      "Limits",
      "Where their check plugs in",
      "Files",
      "Credits",
    ];
    let at = -1;
    for (const h of heads) {
      const i = readme.indexOf(`## ${h}`, at + 1);
      expect(i, `missing or out of order: ${h}`).toBeGreaterThan(at);
      at = i;
    }
  });
});
