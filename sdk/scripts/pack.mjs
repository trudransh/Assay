// Builds the SDK and assembles sdk/npm/, the folder published to npm as `assay-receipts`.
// Inside this repo the package stays `@assay/receipts` (workspace imports); the public name differs
// because the `@assay` npm scope belongs to someone else.
//   node scripts/pack.mjs && (cd npm && npm publish --access public)   (not "npm publish sdk/npm": npm reads that as GitHub user/repo)
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const at = (p) => new URL(p, root).pathname;
const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));

rmSync(at("dist"), { recursive: true, force: true });
execSync("npx tsc -p .", { cwd: at("."), stdio: "inherit" });

const out = at("npm/");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(at("dist"), `${out}dist`, { recursive: true });
cpSync(at("README.md"), `${out}README.md`);
cpSync(at("../LICENSE"), `${out}LICENSE`);
writeFileSync(
  `${out}package.json`,
  JSON.stringify(
    {
      name: "assay-receipts",
      version: pkg.publishVersion,
      description: "Signed receipts for AI responses: build, sign, verify and anchor them on Monad.",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files: ["dist", "README.md", "LICENSE"],
      sideEffects: false,
      engines: { node: ">=20" },
      dependencies: pkg.dependencies,
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/trudransh/Assay.git", directory: "sdk" },
      homepage: "https://assay.gitbook.io/assay-docs",
      keywords: ["ai", "receipts", "monad", "erc-8004", "webauthn", "passkey", "verifiable", "inference"],
    },
    null,
    2,
  ) + "\n",
);
console.log(`sdk/npm ready: assay-receipts@${pkg.publishVersion}`);
