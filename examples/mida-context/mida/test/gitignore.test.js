import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const FOLDER = path.resolve(import.meta.dirname, "..");

const checkIgnore = (name) =>
  spawnSync("git", ["check-ignore", "-v", name], { cwd: FOLDER, encoding: "utf8" });

describe("the folder .gitignore", () => {
  it("covers every name the code can create", () => {
    for (const name of [
      ".env",
      ".env.local",
      "runs/0x" + "ab".repeat(32) + ".json",
      "runs/.0x" + "ab".repeat(32) + ".tmp",
      ".mida/project.json",
      "exports/record.json",
      "exports/.record.json.1234.tmp",
      "node_modules/x/index.js",
    ]) {
      const r = checkIgnore(name);
      expect(r.status, `${name}: not ignored — ${r.stdout.trim()} ${r.stderr.trim()}`).toBe(0);
      expect(r.stdout, `${name}: ignored by a rule outside this folder's .gitignore`).toContain(
        "examples/mida-context/mida/.gitignore",
      );
    }
  });

  it("does not swallow the files that must be committed", () => {
    for (const name of [
      "package.json",
      "package-lock.json",
      "README.md",
      ".env.example",
      "src/cli.js",
      "test/gitignore.test.js",
    ]) {
      const r = checkIgnore(name);
      expect(r.status, `${name}: unexpectedly ignored — ${r.stdout.trim()}`).toBe(1);
    }
  });
});
