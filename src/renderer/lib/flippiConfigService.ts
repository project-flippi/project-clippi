import fs from "fs";
import path from "path";
import os from "os";

const POLL_INTERVAL_MS = 5000;
const CONFIG_PATH = path.join(os.homedir(), "project-flippi", "flippi-config.json");

let timer: ReturnType<typeof setInterval> | null = null;
let lastHost: string | null = null;
let lastPort: string | null = null;
let lastPassword: string | null = null;
let wasFlippiManaged = false;

function getStore() {
  // Lazy require to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("@/store").store;
}

function poll(): void {
  let config: any = null;

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — Flippi is not managing
  }

  const store = getStore();
  const dispatch = store.dispatch;

  const obsWebsocket = config?.obsWebsocket;
  if (!obsWebsocket || !obsWebsocket.host || !obsWebsocket.port) {
    // Flippi is not managing OBS settings
    if (wasFlippiManaged) {
      dispatch.tempContainer.setOBSFlippiManaged(false);
      wasFlippiManaged = false;
      lastHost = null;
      lastPort = null;
      lastPassword = null;
    }
    return;
  }

  // Flippi is providing OBS settings
  const { host, port, password } = obsWebsocket;
  const settingsChanged = host !== lastHost || port !== lastPort || password !== lastPassword;

  if (settingsChanged) {
    dispatch.slippi.setOBSAddress(host);
    dispatch.slippi.setOBSPort(port);
    dispatch.slippi.setOBSPassword(password || "");

    lastHost = host;
    lastPort = port;
    lastPassword = password || "";

    // Trigger reconnect if not already connected
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OBSConnectionStatus } = require("@/lib/obsTypes");
    const state = store.getState();
    if (state.tempContainer.obsConnectionStatus !== OBSConnectionStatus.CONNECTED) {
      // Small delay to let Redux state settle before connecting
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { connectToOBS } = require("@/lib/obs");
        connectToOBS().catch((err: Error) => {
          console.warn("[flippiConfig] OBS connect failed:", err.message);
        });
      }, 500);
    }
  }

  if (!wasFlippiManaged) {
    dispatch.tempContainer.setOBSFlippiManaged(true);
    wasFlippiManaged = true;
  }
}

export function startFlippiConfigPolling(): void {
  if (timer) {
    return;
  }
  poll(); // initial check
  timer = setInterval(poll, POLL_INTERVAL_MS);
}

export function stopFlippiConfigPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
