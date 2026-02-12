import { remote } from "electron";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";

const STATUS_FILENAME = "connection-status.json";

// Use appData (e.g. C:\Users\<user>\AppData\Roaming) + fixed folder name
// so Flippi can always find it. We avoid getPath("userData") because that
// returns "Electron" in dev mode instead of "Project Clippi".
const STATUS_DIR = path.join(remote.app.getPath("appData"), "Project Clippi");

interface ConnectionStatusFile {
  obsConnected: boolean;
  slippiConnected: boolean;
  updatedAt: number;
}

let prevObs: boolean | null = null;
let prevSlippi: boolean | null = null;

function getStatusFilePath(): string {
  return path.join(STATUS_DIR, STATUS_FILENAME);
}

async function writeStatusFile(data: ConnectionStatusFile): Promise<void> {
  const filePath = getStatusFilePath();
  const tmpPath = filePath + ".tmp";
  try {
    await fs.ensureDir(STATUS_DIR);
    await fs.writeJson(tmpPath, data);
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    log.warn("Failed to write connection status file:", err);
  }
}

export function writeConnectionStatusIfChanged(obsConnected: boolean, slippiConnected: boolean): void {
  if (obsConnected === prevObs && slippiConnected === prevSlippi) {
    return;
  }
  prevObs = obsConnected;
  prevSlippi = slippiConnected;
  writeStatusFile({
    obsConnected,
    slippiConnected,
    updatedAt: Date.now(),
  });
}

export function writeDisconnectedStatus(): void {
  prevObs = false;
  prevSlippi = false;
  // Use sync write for beforeunload reliability
  const filePath = getStatusFilePath();
  const tmpPath = filePath + ".tmp";
  try {
    fs.ensureDirSync(STATUS_DIR);
    fs.writeJsonSync(tmpPath, {
      obsConnected: false,
      slippiConnected: false,
      updatedAt: Date.now(),
    } as ConnectionStatusFile);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    log.warn("Failed to write disconnected status file:", err);
  }
}
