import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installIpcBridge } from "./dev-ipc-bridge.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repo, "app");
const tauriCli = path.join(appDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
const testExeDir = path.join(repo, "target", "debug");
const testData = path.join(testExeDir, "data");
const portableMarker = path.join(testExeDir, "portable.txt");
const installedRoot = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const standardDataRoot = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const standardDataDir = path.join(standardDataRoot, "ZeluxDL");
const devIpcPath = path.join(testData, "ipc.json");
const standardIpcPath = path.join(standardDataDir, "ipc.json");
const installedHost = path.join(installedRoot, "ZeluxDL", "zeluxdl-native-host.exe");
const installedManifestDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, "ZeluxDL", "native-messaging")
  : null;

mkdirSync(testData, { recursive: true });
if (!existsSync(portableMarker)) writeFileSync(portableMarker, "ZeluxDL isolated development profile\n");

const child = spawn(process.execPath, [tauriCli, "dev", "--config", "src-tauri/tauri.dev.conf.json"], {
  cwd: appDir,
  env: { ...process.env, PRISM_DATA_DIR: testData, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "1" },
  stdio: "inherit",
});

let restoreIpcBridge = null;
let stopIpcBridgeWatch = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function watchForDevIpc() {
  while (!stopIpcBridgeWatch && child.exitCode === null && child.signalCode === null) {
    if (!restoreIpcBridge && existsSync(devIpcPath)) {
      try {
        restoreIpcBridge = installIpcBridge({ sourcePath: devIpcPath, targetPath: standardIpcPath });
        console.log(`Native host IPC bridge points to the isolated dev app: ${standardIpcPath}`);
      } catch (error) {
        if (/dev app is not running/i.test(error.message)) {
          await wait(200);
          continue;
        }
        console.error(`Could not safely connect the browser host to the dev app: ${error.message}`);
        child.kill();
        process.exitCode = 1;
        return;
      }
    }
    await wait(200);
  }
}
void watchForDevIpc();

child.on("error", (error) => {
  console.error(`Could not start Tauri test build: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  stopIpcBridgeWatch = true;
  if (restoreIpcBridge && !restoreIpcBridge()) {
    console.warn("IPC bridge cleanup skipped because another process replaced its pointer.");
  }
  if (existsSync(installedHost) && installedManifestDir) {
    const restore = spawnSync(installedHost, ["register", "--manifest-dir", installedManifestDir, "--host-path", installedHost], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (restore.error) console.error(`Could not restore installed native host registration: ${restore.error.message}`);
  }
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
