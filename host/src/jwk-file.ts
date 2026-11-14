import { readFileSync } from "node:fs";
import { parseJwk } from "./config.js";

/// Loads a JWK file and fills in `kid` when the file has none.
export async function readJwk(path: string) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`cannot read JWK at ${path} (run scripts/keygen.ts first?): ${(e as Error).message}`);
  }
  return parseJwk(text, path);
}
