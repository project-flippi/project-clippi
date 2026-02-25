import { ConnectionEvent, ConnectionStatus } from "@slippi/slippi-js";
import { SlpFolderStream, SlpLiveStream, SlpRealTime } from "@vinceau/slp-realtime";
import log from "electron-log";

import { LiveContext } from "@/lib/liveContext";
import { Ports } from "@slippi/slippi-js";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const getStore = () => (require("@/store") as any).store;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifyLazy = (...args: any[]) => (require("./utils") as any).notify(...args);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const getDispatch = () => (require("@/store") as any).store?.dispatch ?? (require("@/store") as any).dispatcher;

import { eventActionManager } from "../containers/actions";
import type { EventManagerConfig } from "./automator_manager";
import { EventManager } from "./automator_manager";

class SlpStreamManager {
  private stream: SlpLiveStream | SlpFolderStream | null = null;
  private realtime: SlpRealTime;
  private eventManager: EventManager;

  public constructor() {
    this.realtime = new SlpRealTime();
    this.eventManager = new EventManager(this.realtime);
    this.eventManager.events$.subscribe((event) => {
      eventActionManager.emitEvent(event.id, event);
    });
  }

  //allows for other parts of the app to get direct access to event manager
  public getEventManager(): EventManager {
    return this.eventManager;
  }

  public testRunEvent(eventId: string) {
    eventActionManager.emitEvent(eventId);
  }

  public updateEventConfig(config: EventManagerConfig) {
    console.log("using config:");
    console.log(config);
    this.eventManager.updateConfig(config);
  }

  public async connectToSlippi(
    address = "0.0.0.0",
    slpPort = 1667,
    type: "dolphin" | "console" = "console"
  ): Promise<void> {
    console.log(`attempt to connect to slippi on ${address}:${slpPort}`);

    // Clean up old stream before creating a new one
    if (this.stream && "connection" in this.stream) {
      this.stream.connection.removeAllListeners();
      this.stream.connection.disconnect();
    }
    this.stream = null;

    const connType = type === "dolphin" ? "Slippi Dolphin" : "Slippi relay";
    const stream = new SlpLiveStream(type);
    stream.connection.on(ConnectionEvent.ERROR, (err) => {
      log.error(err);
    });
    stream.connection.on(ConnectionEvent.STATUS_CHANGE, (status: ConnectionStatus) => {
      getDispatch().tempContainer.setSlippiConnectionStatus(status);
      if (status === ConnectionStatus.CONNECTED) {
        getDispatch().tempContainer.setSlippiConnectionType(type);
        notifyLazy(`Connected to ${connType}`);
      } else if (status === ConnectionStatus.DISCONNECTED) {
        notifyLazy(`Disconnected from ${connType}`);
      }
    });
    console.log(stream.connection);
    try {
      await stream.start(address, slpPort);
    } catch (err) {
      stream.connection.removeAllListeners();
      throw err;
    }
    this.realtime.setStream(stream);
    this.stream = stream;
    try {
      console.log("[LiveContext] realtime.ts → start() after stream set", new Date().toISOString());
      LiveContext.start(this.realtime);
    } catch (e) {
      console.warn("[LiveContext] start() threw:", e);
    }
  }

  public disconnectFromSlippi(): void {
    if (this.stream && "connection" in this.stream) {
      this.stream.connection.removeAllListeners();
      this.stream.connection.disconnect();
    }
    this.stream = null;
    // Manually dispatch disconnected status since listeners were removed before disconnect()
    getDispatch().tempContainer.setSlippiConnectionStatus(ConnectionStatus.DISCONNECTED);
    try {
      console.log("[LiveContext] realtime.ts → stop() on stream clear/teardown", new Date().toISOString());
      LiveContext.stop();
    } catch (e) {
      console.warn("[LiveContext] stop() threw:", e);
    }
  }

  public async monitorSlpFolder(filepath: string): Promise<void> {
    try {
      const stream = new SlpFolderStream();
      await stream.start(filepath);
      this.realtime.setStream(stream);
      this.stream = stream;
      getDispatch().tempContainer.setSlpFolderStream(filepath);
      try {
        console.log("[LiveContext] realtime.ts → start() after stream set", new Date().toISOString());
        LiveContext.start(this.realtime);
      } catch (e) {
        console.warn("[LiveContext] start() threw:", e);
      }
    } catch (err) {
      console.error(err);
      notifyLazy("Could not monitor folder. Are you sure it exists?");
    }
  }

  public stopMonitoringSlpFolder(): void {
    if (this.stream && "stop" in this.stream) {
      this.stream.stop();
    }
    this.stream = null;
    getDispatch().tempContainer.clearSlpFolderStream();
    try {
      console.log("[LiveContext] realtime.ts → stop() on stream clear/teardown", new Date().toISOString());
      LiveContext.stop();
    } catch (e) {
      console.warn("[LiveContext] stop() threw:", e);
    }
  }
}

export const streamManager = new SlpStreamManager();

export const eventManagerCtx = {
  eventManager: streamManager.getEventManager(),
};

type AutoConnectState = {
  started: boolean;
  timer: ReturnType<typeof setInterval> | null;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  connecting: boolean;
  firstSuccessToastShown: boolean;
  hadFailureSinceLastSuccess: boolean;
};

const INTERVAL_MS = 15000;
const RECONNECT_DELAY_MS = 5000;

// HMR-safe singleton (same pattern as obs.ts)
const g = globalThis as any;
if (!g.__slippiDolphinAutoconnect) {
  g.__slippiDolphinAutoconnect = {
    started: false,
    timer: null,
    reconnectTimeout: null,
    connecting: false,
    firstSuccessToastShown: false,
    hadFailureSinceLastSuccess: false,
  } as AutoConnectState;
}
const ac: AutoConnectState = g.__slippiDolphinAutoconnect;

// --- Helpers ---

function isConnectedToDolphin(): boolean {
  try {
    const state = getStore().getState();
    const status = state?.tempContainer?.slippiConnectionStatus;
    const type = state?.tempContainer?.slippiConnectionType;

    // tolerate enum/string/number
    const connected = status === "CONNECTED" || status === "connected" || status === 2;
    return connected && type === "dolphin";
  } catch {
    return false;
  }
}

function isAutoEnabled(): boolean {
  try {
    return !!getStore().getState()?.slippi?.autoConnectDolphin;
  } catch {
    return false;
  }
}

// --- Core loop, OBS-style ---

const startTimer = () => {
  if (ac.timer) {
    return;
  }
  attemptConnect();
  ac.timer = setInterval(attemptConnect, INTERVAL_MS);
};

const stopTimer = () => {
  if (ac.timer) {
    clearInterval(ac.timer);
    ac.timer = null;
  }
  if (ac.reconnectTimeout) {
    clearTimeout(ac.reconnectTimeout);
    ac.reconnectTimeout = null;
  }
};

async function attemptConnect() {
  // Enabled?
  if (!isAutoEnabled()) {
    return;
  }
  // Avoid overlap
  if (ac.connecting) {
    return;
  }
  // Already connected to Dolphin?
  if (isConnectedToDolphin()) {
    return;
  }

  ac.connecting = true;
  try {
    await (streamManager as any).connectToSlippi("127.0.0.1", Ports.DEFAULT, "dolphin");

    if (!ac.firstSuccessToastShown || ac.hadFailureSinceLastSuccess) {
      notifyLazy("Connected to Slippi Dolphin", "success");
      ac.firstSuccessToastShown = true;
    }
    ac.hadFailureSinceLastSuccess = false;

    // Stop retries while connected; we'll resume on disconnect (via subscription below)
    stopTimer();
  } catch {
    // First failure after any success → single toast, then be quiet
    if (!ac.hadFailureSinceLastSuccess) {
      notifyLazy("Slippi Dolphin connection failed; retrying…", "warning");
      ac.hadFailureSinceLastSuccess = true;
    }
    // keep timer running; next tick will retry
  } finally {
    ac.connecting = false;
  }
}

/**
 * Start observers once per app session / HMR lifetime (mirrors obs.ts).
 */
export const startSlippiDolphinAutoconnectService = (): void => {
  if (ac.started) {
    return;
  }
  ac.started = true;

  // React to STORE changes (both: toggle and connected status)
  let lastEnabled = isAutoEnabled();
  let lastConnected = isConnectedToDolphin();

  getStore().subscribe(() => {
    const enabled = isAutoEnabled();
    const connected = isConnectedToDolphin();

    // Toggle change
    if (enabled !== lastEnabled) {
      if (enabled) {
        if (!connected) {
          startTimer();
        }
      } else {
        stopTimer();
      }
    }

    // Connection state change
    if (connected !== lastConnected) {
      if (connected) {
        // pause while connected
        stopTimer();
      } else if (enabled) {
        // disconnected + enabled → delay before retrying to let the OS release the port
        stopTimer();
        ac.reconnectTimeout = setTimeout(() => {
          ac.reconnectTimeout = null;
          startTimer();
        }, RECONNECT_DELAY_MS);
      }
    }

    lastEnabled = enabled;
    lastConnected = connected;
  });

  // Initial boot behavior
  const enabledAtBoot = isAutoEnabled();
  if (enabledAtBoot && !isConnectedToDolphin()) {
    startTimer();
  }
};

// Clean up on HMR dispose (optional, like obs.ts)
if (module && (module as any).hot) {
  (module as any).hot.dispose(() => {
    stopTimer();
    ac.started = false;
    ac.connecting = false;
    // keep firstSuccessToastShown & hadFailureSinceLastSuccess across HMR to avoid re-toasting
  });
}
