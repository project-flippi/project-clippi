import fs from "fs";
import path from "path";
import os from "os";

const POLL_INTERVAL_MS = 5000;
const CONFIG_PATH = path.join(os.homedir(), "project-flippi", "flippi-config.json");

let timer: ReturnType<typeof setInterval> | null = null;
let wasFlippiManaged = false;
let connectPending = false;

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
    }
    return;
  }

  // Flippi is providing OBS settings — compare against actual Redux state
  // rather than module-level vars, so we detect if persist rehydration
  // or other sources overwrote our dispatched values.
  const { host, port, password: rawPassword } = obsWebsocket;
  const password = rawPassword || "";
  const state = store.getState();
  const reduxAddress = state.slippi.obsAddress;
  const reduxPort = state.slippi.obsPort;
  const reduxPassword = state.slippi.obsPassword;

  const reduxMatchesConfig = reduxAddress === host && reduxPort === port && reduxPassword === password;

  if (!reduxMatchesConfig) {
    dispatch.slippi.setOBSAddress(host);
    dispatch.slippi.setOBSPort(port);
    dispatch.slippi.setOBSPassword(password);
  }

  // Ensure auto-connect is enabled when Flippi manages OBS settings,
  // so the retry loop kicks in as a fallback if the initial connect fails.
  if (!state.slippi.autoConnectOBS) {
    dispatch.slippi.setAutoConnectOBS(true);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OBSConnectionStatus } = require("@/lib/obsTypes");
  const notConnected = state.tempContainer.obsConnectionStatus !== OBSConnectionStatus.CONNECTED;

  // Retry connection when Flippi is managing and OBS is not connected.
  // This handles: persist rehydration overwriting settings, OBS not ready
  // on first attempt, or any other transient connection failure.
  if (notConnected && !connectPending) {
    connectPending = true;
    const delay = reduxMatchesConfig ? 0 : 500;
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { connectToOBS } = require("@/lib/obs");
      connectToOBS()
        .catch((err: Error) => {
          console.warn("[flippiConfig] OBS connect failed:", err.message);
        })
        .finally(() => {
          connectPending = false;
        });
    }, delay);
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
