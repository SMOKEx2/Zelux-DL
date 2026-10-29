// Builds prism-native-host and places it where Tauri's `externalBin` expects it:
// app/src-tauri/binaries/prism-native-host-<target-triple>[.exe]
//
// Usage: node scripts/build-sidecar.mjs [--debug] [--target <triple>]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const targetIdx = args.indexOf("--target");
const hostTriple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const triple = targetIdx >= 0 ? args[targetIdx + 1] : process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple;

const cargoArgs = ["build", "-p", "prism-native-host", "--target", triple];
if (!debug) cargoArgs.push("--release");
execFileSync("cargo", cargoArgs, { cwd: root, stdio: "inherit" });

const ext = triple.includes("windows") ? ".exe" : "";
const built = join(root, "target", triple, debug ? "debug" : "release", `zeluxdl-native-host${ext}`);
const outDir = join(root, "app", "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `zeluxdl-native-host-${triple}${ext}`);
copyFileSync(built, out);
console.log(`sidecar: ${out}`);
