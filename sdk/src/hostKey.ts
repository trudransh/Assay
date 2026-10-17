import { keccak256, stringToBytes, type Hex } from "viem";

/// D21: grades for an Assay host follow its ERC-8004 identity, so rotating the signing key can't shed a bad grade.
export function hostKeyForAgent(chainId: bigint | number, agentId: bigint | number): Hex {
  return keccak256(stringToBytes(`erc8004:${BigInt(chainId)}:${BigInt(agentId)}`));
}

/// Unkeyed endpoints (e.g. an OpenRouter provider). Same bytes as Solidity keccak256(abi.encodePacked("openrouter:", tag)).
export function hostKeyForEndpoint(tag: string): Hex {
  return keccak256(stringToBytes(`openrouter:${tag}`));
}

/// A lab's own API graded directly (harness `--base-url`), tagged `direct:<host>`. Same convention as harness/export_grade.py.
export function hostKeyForDirect(host: string): Hex {
  return keccak256(stringToBytes(`direct:${host}`));
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
// Every convention above is keccak256 of a prefixed string, so the spec itself is the preimage.
const HOST_SPEC = /^(erc8004:\d+:\d+|openrouter:.+|direct:.+)$/;

/// "erc8004:<chain>:<id>", "openrouter:<tag>", "direct:<host>" or a 0x bytes32 host key, as a host key; null for anything else.
export function hostKeyOf(spec: string): Hex | null {
  if (BYTES32.test(spec)) return spec.toLowerCase() as Hex;
  return HOST_SPEC.test(spec) ? keccak256(stringToBytes(spec)) : null;
}
