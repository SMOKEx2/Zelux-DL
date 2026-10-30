import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseIpc(raw, sourcePath) {
  const ipc = JSON.parse(raw);
  if (
    !Number.isInteger(ipc.port) || ipc.port < 1 || ipc.port > 65535 ||
    !Number.isInteger(ipc.pid) || ipc.pid < 1 ||
    typeof ipc.token !== "string" || !ipc.token ||
    typeof ipc.version !== "string" || !ipc.version
  ) {
    throw new Error(`Invalid ZeluxDL IPC pointer at ${sourcePath}`);
  }
  return ipc;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function replaceFile(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, contents, { flag: "wx" });
    renameSync(tempPath, filePath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch { /* no temp file to clean */ }
    throw error;
  }
}

/** Temporarily expose the isolated dev app's IPC pointer to a native host using the default data dir. */
export function installIpcBridge({ sourcePath, targetPath, isPidAlive: alive = isProcessAlive }) {
  const sourceRaw = readFileSync(sourcePath, "utf8");
  const source = parseIpc(sourceRaw, sourcePath);
  if (!alive(source.pid)) throw new Error(`The ZeluxDL dev app is not running (pid ${source.pid})`);
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new Error("Dev IPC bridge source and target must be different files");
  }

  let previousRaw = null;
  if (existsSync(targetPath)) {
    previousRaw = readFileSync(targetPath, "utf8");
    const previous = parseIpc(previousRaw, targetPath);
    if (alive(previous.pid)) {
      throw new Error(`A ZeluxDL app is already running (pid ${previous.pid}); refusing to replace its IPC pointer`);
    }
  }

  replaceFile(targetPath, sourceRaw);
  let restored = false;
  return () => {
    if (restored) return false;
    let current;
    try {
      current = parseIpc(readFileSync(targetPath, "utf8"), targetPath);
    } catch {
      return false;
    }
    if (current.pid !== source.pid || current.port !== source.port || current.token !== source.token) return false;
    if (previousRaw === null) unlinkSync(targetPath);
    else replaceFile(targetPath, previousRaw);
    restored = true;
    return true;
  };
}
