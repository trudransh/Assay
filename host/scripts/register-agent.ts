// Registers the host on the ERC-8004 IdentityRegistry (unless HOST_AGENT_ID is set) and points
// ReceiptAnchor.setHostKey at the key in HOST_JWK_PATH. Sends real transactions.
// Env: OWNER_PRIVATE_KEY (agent owner), MONAD_RPC_URL, ANCHOR_ADDRESS, HOST_JWK_PATH, HOST_AGENT_ID?, AGENT_URI?
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { makeClients, monadTestnet, sendTx } from "../src/chain.js";
import { readJwk } from "../src/jwk-file.js";
import { IDENTITY_REGISTRY } from "../src/server.js";

const need = (name: string) => process.env[name] || (console.error(`${name} is required`), process.exit(1));
const rpc = need("MONAD_RPC_URL");
const anchor = need("ANCHOR_ADDRESS") as Address;
const ownerKey = need("OWNER_PRIVATE_KEY") as Hex;
const agentUri = process.env.AGENT_URI ?? "https://raw.githubusercontent.com/trudransh/Assay/main/docs/agents/host.json";
const jwkPath = resolve(fileURLToPath(new URL("..", import.meta.url)), process.env.HOST_JWK_PATH ?? ".keys/host.jwk.json");

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
const anchorAbi = parseAbi([
  "function setHostKey(uint256 agentId, bytes32 qx, bytes32 qy)",
  "function hostKeys(uint256 agentId) view returns (bytes32 qx, bytes32 qy)",
]);

const { clients, relayer: owner } = makeClients([rpc], ownerKey);
const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

let agentId: bigint;
if (process.env.HOST_AGENT_ID) {
  agentId = BigInt(process.env.HOST_AGENT_ID);
  console.log(`reusing agentId ${agentId}`);
} else {
  const tx = await sendTx(clients, { address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "register", args: [agentUri] });
  const receipt = await pub.getTransactionReceipt({ hash: tx });
  const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: receipt.logs });
  agentId = ev.args.agentId;
  console.log(`registered agentId ${agentId} for ${owner}, tx ${tx}`);
}

const jwk = await readJwk(jwkPath);
const qx = toHex(Buffer.from(jwk.x!, "base64url"), { size: 32 });
const qy = toHex(Buffer.from(jwk.y!, "base64url"), { size: 32 });
const [curX, curY] = await pub.readContract({ address: anchor, abi: anchorAbi, functionName: "hostKeys", args: [agentId] });
if (curX === qx && curY === qy) {
  console.log(`host key already set for agent ${agentId}`);
} else {
  const tx = await sendTx(clients, { address: anchor, abi: anchorAbi, functionName: "setHostKey", args: [agentId, qx, qy] });
  console.log(`setHostKey(${agentId}) tx ${tx}`);
}
console.log(`kid ${jwk.kid}\nset HOST_AGENT_ID=${agentId} in .env`);
