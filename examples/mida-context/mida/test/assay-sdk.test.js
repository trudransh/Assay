import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssaySdkError, loadAssaySdk } from "../src/assay-sdk.js";
import { loadConfig } from "../src/config.js";

async function problem(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("did not reject");
}

describe("the default SDK path", () => {
  it("resolves ../../../sdk from this folder to ASSAY's real sdk (src/record.ts on disk)", () => {
    const { sdkDir } = loadConfig({ MIDA_HOME: "/Users/test/.mida-assay" });
    expect(existsSync(join(sdkDir, "src", "record.ts"))).toBe(true);
    expect(existsSync(join(sdkDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(sdkDir, "package.json"))).toBe(true);
  });
});

describe("loadAssaySdk", () => {
  it("refuses a dir with no dist/index.js, naming the two owner commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    const e = await problem(loadAssaySdk(dir));
    expect(e).toBeInstanceOf(AssaySdkError);
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe(
      `assay: the ASSAY SDK is not built at ${dir}/dist. At the repository root run: npx --yes pnpm@10.20.0 install --frozen-lockfile && npx --yes pnpm@10.20.0 --filter @assay/receipts build. Nothing was done.`,
    );
  });

  it("loads a built dist/index.js", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    await mkdir(join(dir, "dist"));
    await writeFile(join(dir, "dist", "index.js"), 'export const verifyReceipt = () => "x";\n');
    const mod = await loadAssaySdk(dir);
    expect(mod.verifyReceipt()).toBe("x");
  });

  it("refuses a dist that throws on import, naming the error class only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-sdk-"));
    await mkdir(join(dir, "dist"));
    await writeFile(
      join(dir, "dist", "index.js"),
      'throw new SyntaxError("a host or RPC body could be quoted here");\n',
    );
    const e = await problem(loadAssaySdk(dir));
    expect(e).toBeInstanceOf(AssaySdkError);
    expect(e.message.startsWith(`assay: the ASSAY SDK at ${dir}/dist could not be loaded (`)).toBe(true);
    expect(e.message).toContain("SyntaxError");
    expect(e.message).not.toContain("a host or RPC body could be quoted here");
  });
});
