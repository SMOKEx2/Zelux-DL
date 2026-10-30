import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installIpcBridge } from "./dev-ipc-bridge.mjs";

test("the test host's standard data directory temporarily points to the running dev app and restores afterward", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zelux-ipc-bridge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourceDir = path.join(dir, "portable", "data");
  const standardDir = path.join(dir, "roaming", "ZeluxDL");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(standardDir, { recursive: true });
  const source = path.join(sourceDir, "ipc.json");
  const target = path.join(standardDir, "ipc.json");
  const devIpc = JSON.stringify({ port: 61794, token: "dev-secret", pid: 43210, version: "2.0.4" });
  const oldIpc = JSON.stringify({ port: 55123, token: "old-secret", pid: 98765, version: "2.0.3" });
  writeFileSync(source, devIpc);
  writeFileSync(target, oldIpc);

  const restore = installIpcBridge({ sourcePath: source, targetPath: target, isPidAlive: (pid) => pid === 43210 });
  assert.equal(readFileSync(target, "utf8"), devIpc);

  assert.equal(restore(), true);
  assert.equal(readFileSync(target, "utf8"), oldIpc);
});

test("the test launcher refuses to replace a live app IPC pointer", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zelux-ipc-bridge-live-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "test-ipc.json");
  const target = path.join(dir, "standard-ipc.json");
  writeFileSync(source, JSON.stringify({ port: 61794, token: "dev-secret", pid: 43210, version: "2.0.4" }));
  writeFileSync(target, JSON.stringify({ port: 55123, token: "live-secret", pid: 12345, version: "2.0.4" }));

  assert.throws(
    () => installIpcBridge({ sourcePath: source, targetPath: target, isPidAlive: () => true }),
    /already running/,
  );
  assert.equal(JSON.parse(readFileSync(target, "utf8")).token, "live-secret");
});

test("the test launcher waits for a live dev app instead of publishing stale IPC", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zelux-ipc-bridge-stale-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "test-ipc.json");
  const target = path.join(dir, "standard-ipc.json");
  writeFileSync(source, JSON.stringify({ port: 61794, token: "stale-secret", pid: 43210, version: "2.0.4" }));

  assert.throws(
    () => installIpcBridge({ sourcePath: source, targetPath: target, isPidAlive: () => false }),
    /dev app is not running/i,
  );
  assert.equal(existsSync(target), false);
});

test("cleanup never removes an IPC pointer replaced by another app", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zelux-ipc-bridge-replaced-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "test-ipc.json");
  const target = path.join(dir, "standard-ipc.json");
  writeFileSync(source, JSON.stringify({ port: 61794, token: "dev-secret", pid: 43210, version: "2.0.4" }));

  const restore = installIpcBridge({ sourcePath: source, targetPath: target, isPidAlive: (pid) => pid === 43210 });
  writeFileSync(target, JSON.stringify({ port: 55123, token: "other-secret", pid: 12345, version: "2.0.4" }));
  assert.equal(restore(), false);
  assert.equal(JSON.parse(readFileSync(target, "utf8")).token, "other-secret");
});
