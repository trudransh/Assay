import { access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export class AssaySdkError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssaySdkError";
    this.exitCode = 1;
  }
}

// The bridge to ASSAY's SDK: nothing of theirs is re-typed here. `sdkDir` holds their package
// (their `sdk/`, built by the owner with `pnpm --filter @assay/receipts build`, which emits
// `dist/index.js`). Fails with one line that names the two owner commands.
export async function loadAssaySdk(sdkDir) {
  const distDir = join(sdkDir, "dist");
  const entry = join(distDir, "index.js");
  try {
    await access(entry);
  } catch {
    throw new AssaySdkError(
      `assay: the ASSAY SDK is not built at ${sdkDir}/dist. At the repository root run: npx --yes pnpm@10.20.0 install --frozen-lockfile && npx --yes pnpm@10.20.0 --filter @assay/receipts build. Nothing was done.`,
    );
  }
  try {
    return await import(pathToFileURL(entry).href);
  } catch (e) {
    throw new AssaySdkError(
      `assay: the ASSAY SDK at ${sdkDir}/dist could not be loaded (${e?.name ?? "Error"}). Nothing was done.`,
    );
  }
}
