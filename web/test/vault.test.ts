import { bytesToHex, hexToBytes, recoverMessageAddress, sha256, stringToBytes, type Hex } from "viem";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  deriveKeyBytes,
  openDisclosure,
  openVault,
  prfSalt,
  requesterAddress,
  requesterLabel,
  revealKey,
  revealLabel,
  sealDisclosure,
  sealVault,
  signReceiptHash,
  VAULT_LABEL,
  type VaultEntry,
} from "../src/lib/vault.js";

// Stand-ins for PRF outputs: in the browser each comes from getPasskeyPrfOutput with that namespace's salt.
const fakePrf = (label: string) => sha256(stringToBytes(`fake-passkey|${label}`), "bytes");

const h1 = `0x${"11".repeat(32)}` as Hex;
const h2 = `0x${"22".repeat(32)}` as Hex;
const entry = (receiptHash: Hex): VaultEntry => ({
  receiptHash,
  body: { v: "assay-receipt/0" } as VaultEntry["body"],
  jws: "a.b.c",
  salt: `0x${"ab".repeat(32)}`,
  output: "OK",
  savedAt: 1,
});

describe("namespaces", () => {
  it("salts are sha256 of the label and differ per namespace", () => {
    expect(prfSalt(VAULT_LABEL)).toEqual(sha256(stringToBytes("assay:vault:v1"), "bytes"));
    const salts = [VAULT_LABEL, requesterLabel("a"), requesterLabel("b"), revealLabel(h1)].map((l) => prfSalt(l).join());
    expect(new Set(salts).size).toBe(4);
  });

  it("the same PRF output gives different keys per label", async () => {
    const prf = fakePrf("x");
    expect(await deriveKeyBytes(prf, VAULT_LABEL)).not.toEqual(await deriveKeyBytes(prf, revealLabel(h1)));
    expect(await deriveKeyBytes(prf, VAULT_LABEL)).toEqual(await deriveKeyBytes(prf, VAULT_LABEL));
  });

  it("rejects PRF output that is not 32 bytes", async () => {
    await expect(deriveKeyBytes(new Uint8Array(31), VAULT_LABEL)).rejects.toThrow(/32 bytes/);
  });
});

describe("vault", () => {
  it("round-trips and fails under a wrong key", async () => {
    const prf = fakePrf(VAULT_LABEL);
    const sealed = await sealVault(prf, [entry(h1), entry(h2)]);
    // The salt's own bytes (66 chars) would show up if anything were stored in the clear. A short marker like
    // "OK" (2 bytes, 4 hex digits) turns up in random ciphertext about 2% of the time, so it made this test flaky.
    expect(sealed.ct).not.toContain(bytesToHex(stringToBytes(entry(h1).salt)).slice(2));
    expect(await openVault(prf, sealed)).toEqual([entry(h1), entry(h2)]);
    await expect(openVault(fakePrf("other passkey"), sealed)).rejects.toThrow(/Decryption failed/);
  });

  it("detects tampering", async () => {
    const prf = fakePrf(VAULT_LABEL);
    const sealed = await sealVault(prf, [entry(h1)]);
    const flipped = (sealed.ct.slice(0, -2) + (sealed.ct.endsWith("00") ? "01" : "00")) as Hex;
    await expect(openVault(prf, { ...sealed, ct: flipped })).rejects.toThrow(/Decryption failed/);
  });
});

describe("reveal keys", () => {
  it("open only their own receipt's entry", async () => {
    const k1 = await revealKey(fakePrf(revealLabel(h1)), h1);
    const k2 = await revealKey(fakePrf(revealLabel(h2)), h2);
    const d1 = await sealDisclosure(k1, entry(h1));
    const d2 = await sealDisclosure(k2, entry(h2));
    expect(await openDisclosure(k1, d1)).toEqual(entry(h1));
    await expect(openDisclosure(k1, d2)).rejects.toThrow(/Decryption failed/);
    // Relabelling a disclosure as another receipt changes the associated data, so it fails too.
    await expect(openDisclosure(k1, { ...d1, receiptHash: h2 })).rejects.toThrow(/Decryption failed/);
  });

  it("cannot open the vault", async () => {
    const prf = fakePrf(VAULT_LABEL);
    const sealed = await sealVault(prf, [entry(h1)]);
    const k1 = await revealKey(fakePrf(revealLabel(h1)), h1);
    await expect(openDisclosure(k1, { receiptHash: h1, sealed })).rejects.toThrow(/Decryption failed/);
  });
});

describe("per-app requester identities", () => {
  const prfA = fakePrf(requesterLabel("app-a"));
  const prfB = fakePrf(requesterLabel("app-b"));

  it("are deterministic and unrelated across apps", async () => {
    const a = await requesterAddress(prfA);
    expect(await requesterAddress(prfA)).toBe(a);
    expect(await requesterAddress(prfB)).not.toBe(a);
    expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("follows the standard Ethereum path, same as viem's mnemonicToAccount", async () => {
    expect(await requesterAddress(prfA)).toBe(mnemonicToAccount(entropyToMnemonic(prfA, wordlist)).address);
  });

  it("EIP-191 signature over the receipt hash recovers to the derived address", async () => {
    const { address, signature } = await signReceiptHash(prfA, h1);
    expect(address).toBe(await requesterAddress(prfA));
    expect(await recoverMessageAddress({ message: { raw: h1 }, signature })).toBe(address);
    expect(await recoverMessageAddress({ message: { raw: hexToBytes(h2) }, signature })).not.toBe(address);
  });
});

describe("sponsored feedback from a per-app key", () => {
  it("signs the call and the 7702 authorization as the per-app address", async () => {
    const { signSponsoredFeedback } = await import("../src/lib/vault.js");
    const { sponsoredCallTypedData } = await import("@assay/receipts");
    const { recoverTypedDataAddress } = await import("viem");
    const { recoverAuthorizationAddress } = await import("viem/utils");
    const prf = sha256(stringToBytes("app A"), "bytes");
    const account = await requesterAddress(prf);
    const impl = "0x00000000000000000000000000000000000A55A7";
    const reputation = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
    const body = await signSponsoredFeedback(prf, { chainId: 10143, accountImpl: impl, reputation, agentId: 1962n, receiptHash: `0x${"a1".repeat(32)}`, value: -1, note: "wrong", nowSeconds: 1_800_000_000, delegationNonce: 0 });
    expect(body.account).toBe(account);
    const call = { target: reputation, data: body.call.data, nonce: BigInt(body.call.nonce), deadline: BigInt(body.call.deadline) } as const;
    expect(await recoverTypedDataAddress({ ...sponsoredCallTypedData(10143, account, call), signature: body.call.signature })).toBe(account);
    expect(await recoverAuthorizationAddress({ authorization: body.authorization! } as never)).toBe(account);
    const later = await signSponsoredFeedback(prf, { chainId: 10143, accountImpl: impl, reputation, agentId: 1962n, receiptHash: `0x${"a1".repeat(32)}`, value: 1, note: "", nowSeconds: 1_800_000_000 });
    expect(later.authorization).toBeUndefined();
  });
});
