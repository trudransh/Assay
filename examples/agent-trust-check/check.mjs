// Two independent, fail-closed checks before an agent acts:
//   1. MonadGuard: is the MCP tool's declared manifest cleared by an attestor I pin?
//   2. Assay: is the model host graded "pass" by a verifier I pin?
// The caller picks the attestors, the verifiers and the threshold. Nothing here merges the two trust models.
import { gate } from "monadguard";

const TOOL = { kind: "mcp", name: "memory-server", origin: "npm:@modelcontextprotocol/server-memory" };
const TOOL_ATTESTORS = [process.env.MONADGUARD_ATTESTOR]; // whose scan verdicts you accept
const ASSAY_HOST = "https://assay-host.assay-host.workers.dev"; // any Assay host serves /v1/grade
const MODEL = "google/gemma-4-31b-it";
const INFERENCE_HOST = "openrouter:google-ai-studio"; // the host you're about to pay
const VERIFIERS = ["0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7"]; // whose grades you accept
const ALLOW = ["pass"];

async function hostGrade() {
  const q = new URLSearchParams({ model: MODEL, host: INFERENCE_HOST, verifiers: VERIFIERS.join(",") });
  const res = await fetch(`${ASSAY_HOST}/v1/grade?${q}`);
  if (!res.ok) throw new Error(`grade lookup failed: HTTP ${res.status}`);
  const { status } = await res.json();
  if (!ALLOW.includes(status)) throw new Error(`inference host ${INFERENCE_HOST} is "${status}" for ${MODEL}`);
  return status;
}

try {
  // Both run; either one throwing stops the agent. Errors fail closed: no answer means no.
  await gate({ ...TOOL, attestors: TOOL_ATTESTORS });
  const status = await hostGrade();
  console.log(`ok: tool cleared by MonadGuard, host graded "${status}" by Assay. Proceed.`);
} catch (e) {
  console.error(`refused: ${e.message}`);
  process.exit(1);
}
