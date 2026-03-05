import { OBSWebSocket } from "obs-websocket-js";
import { BehaviorSubject, EMPTY, forkJoin, from, of, Subject } from "rxjs";
import { catchError, map, skip, switchMap, take } from "rxjs/operators";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const getStore = () => (require("@/store") as any).store;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifyLazy = (...args: any[]) => (require("./utils") as any).notify(...args);

import { OBSRecordingAction, OBSRecordingStatus, OBSConnectionStatus } from "@/lib/obsTypes";
import type { OBSSceneWithItems, OBSSceneItem } from "@/lib/obsTypes";

const ACTION_STATE_MAP: Record<string, string> = {
  [OBSRecordingAction.START]: "OBS_WEBSOCKET_OUTPUT_STARTED",
  [OBSRecordingAction.PAUSE]: "OBS_WEBSOCKET_OUTPUT_PAUSED",
  [OBSRecordingAction.UNPAUSE]: "OBS_WEBSOCKET_OUTPUT_RESUMED",
  [OBSRecordingAction.STOP]: "OBS_WEBSOCKET_OUTPUT_STOPPED",
};

class OBSConnection {
  private readonly socket: OBSWebSocket;
  private readonly refreshScenesSource$ = new Subject<void>();
  private readonly scenesSource$ = new BehaviorSubject<OBSSceneWithItems[]>([]);
  private readonly connectionSource$ = new BehaviorSubject<OBSConnectionStatus>(OBSConnectionStatus.DISCONNECTED);
  private readonly recordingSource$ = new BehaviorSubject<OBSRecordingStatus>(OBSRecordingStatus.STOPPED);

  public connectionStatus$ = this.connectionSource$.asObservable();
  public recordingStatus$ = this.recordingSource$.asObservable();
  public scenes$ = this.scenesSource$.asObservable();

  public constructor() {
    this.socket = new OBSWebSocket();
    // Pipe the result of the refresh scenes to the scenes source
    this.refreshScenesSource$
      .pipe(
        switchMap(() =>
          from(this.socket.call("GetSceneList")).pipe(
            switchMap((data) => {
              const scenes = data.scenes as Array<{ sceneName: string; sceneIndex: number }>;
              if (scenes.length === 0) {
                return of([]);
              }
              return forkJoin(
                scenes.map((scene) =>
                  from(this.socket.call("GetSceneItemList", { sceneName: scene.sceneName as string })).pipe(
                    map(
                      (resp): OBSSceneWithItems => ({
                        sceneName: scene.sceneName as string,
                        sceneIndex: scene.sceneIndex as number,
                        items: ((resp.sceneItems as unknown) as OBSSceneItem[]).map((item: any) => ({
                          sceneItemId: item.sceneItemId,
                          sourceName: item.sourceName,
                          sceneItemEnabled: item.sceneItemEnabled,
                        })),
                      })
                    )
                  )
                )
              );
            }),
            catchError((err) => {
              console.error("Failed to refresh OBS scenes:", err);
              return EMPTY;
            })
          )
        )
      )
      .subscribe(this.scenesSource$);
  }

  public isConnected(): boolean {
    return this.connectionSource$.value === OBSConnectionStatus.CONNECTED;
  }

  public isRecording(): boolean {
    return this.recordingSource$.value !== OBSRecordingStatus.STOPPED;
  }

  public async connect(obsAddress: string, obsPort: string, obsPassword?: string) {
    await this.socket.connect(`ws://${obsAddress}:${obsPort}`, obsPassword || undefined);
    this._setupListeners();
    this.refreshScenesSource$.next();
    this.connectionSource$.next(OBSConnectionStatus.CONNECTED);
  }

  public disconnect() {
    this.socket.disconnect();
    this.connectionSource$.next(OBSConnectionStatus.DISCONNECTED);
  }

  public async setFilenameFormat(format: string): Promise<boolean> {
    await this.socket.call("SetProfileParameter", {
      parameterCategory: "Output",
      parameterName: "FilenameFormatting",
      parameterValue: format,
    });
    const confirmFormat = await this.getFilenameFormat();
    return confirmFormat === format;
  }

  public async getFilenameFormat(): Promise<string> {
    const response = await this.socket.call("GetProfileParameter", {
      parameterCategory: "Output",
      parameterName: "FilenameFormatting",
    });
    return response.parameterValue;
  }

  public async setScene(scene: string) {
    await this.socket.call("SetCurrentProgramScene", {
      sceneName: scene,
    });
  }

  public async saveReplayBuffer() {
    await this.socket.call("SaveReplayBuffer");
  }

  public async setRecordingState(rec: OBSRecordingAction): Promise<void> {
    if (rec === OBSRecordingAction.TOGGLE) {
      return this._safelyToggleRecording();
    }

    return this._safelySetRecordingState(rec);
  }

  private async _safelyToggleRecording(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Resolve when the recording status changed
      this.recordingStatus$
        .pipe(
          // This is going to resolve instantly, so we want to skip the first value
          skip(1),
          // Complete the observable once we get the next value
          take(1)
        )
        .subscribe(() => {
          resolve();
        });
      this.socket.call(OBSRecordingAction.TOGGLE).catch(reject);
    });
  }

  private async _safelySetRecordingState(rec: OBSRecordingAction): Promise<void> {
    const expectedState = ACTION_STATE_MAP[rec];
    return new Promise((resolve, reject) => {
      // Use socket.on instead of socket.once because OBS v5 emits transitional
      // states (e.g. OBS_WEBSOCKET_OUTPUT_STARTING) before the final state.
      // socket.once would catch the transitional event and never match.
      const handler = (data: any) => {
        if (data.outputState === expectedState) {
          this.socket.off("RecordStateChanged" as any, handler);
          resolve();
        }
      };
      this.socket.on("RecordStateChanged" as any, handler);

      this.socket.call(rec as any).catch((err) => {
        this.socket.off("RecordStateChanged" as any, handler);
        reject(err);
      });
    });
  }

  public async setSourceItemVisibility(sourceName: string, visible?: boolean) {
    const scenes = this.scenesSource$.value;
    for (const scene of scenes) {
      const item = scene.items.find((i) => i.sourceName === sourceName);
      if (item) {
        await this.socket.call("SetSceneItemEnabled", {
          sceneName: scene.sceneName,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: Boolean(visible),
        });
      }
    }
  }

  private _setupListeners() {
    // Remove any previous listeners to prevent duplicates on reconnect
    this.socket.removeAllListeners();

    this.socket.on("ConnectionClosed" as any, () => {
      this.connectionSource$.next(OBSConnectionStatus.DISCONNECTED);
    });
    this.socket.on("RecordStateChanged" as any, (data: any) => {
      switch (data.outputState) {
        case "OBS_WEBSOCKET_OUTPUT_STARTED":
          this.recordingSource$.next(OBSRecordingStatus.RECORDING);
          break;
        case "OBS_WEBSOCKET_OUTPUT_PAUSED":
          this.recordingSource$.next(OBSRecordingStatus.PAUSED);
          break;
        case "OBS_WEBSOCKET_OUTPUT_RESUMED":
          this.recordingSource$.next(OBSRecordingStatus.RECORDING);
          break;
        case "OBS_WEBSOCKET_OUTPUT_STOPPED":
          this.recordingSource$.next(OBSRecordingStatus.STOPPED);
          break;
      }
    });

    // Refresh the scenes on these events
    this.socket.on("SceneListChanged" as any, () => {
      this.refreshScenesSource$.next();
    });
    this.socket.on("SceneItemCreated" as any, () => {
      this.refreshScenesSource$.next();
    });
    this.socket.on("SceneItemRemoved" as any, () => {
      this.refreshScenesSource$.next();
    });
  }
}

export const obsConnection = new OBSConnection();

export const connectToOBSAndNotify = (): void => {
  const { obsAddress, obsPort, obsPassword } = getStore().getState().slippi;
  obsConnection
    .connect(obsAddress, obsPort, obsPassword)
    .then(() => {
      notifyLazy("Successfully connected to OBS");
    })
    .catch((err) => {
      console.error(err);
      notifyLazy(`OBS connection failed: ${err.message}`);
    });
};

export const connectToOBS = (): Promise<void> => {
  const { obsAddress, obsPort, obsPassword } = getStore().getState().slippi;
  return obsConnection.connect(obsAddress, obsPort, obsPassword);
};

// -------------------------------
// HMR-safe Auto-connect singleton
// -------------------------------
type AutoConnectState = {
  started: boolean;
  timer: ReturnType<typeof setInterval> | null;
  connecting: boolean;
  firstSuccessToastShown: boolean;
};

const INTERVAL_MS = 15000;

// Keep singleton on globalThis so it survives hot reloads.
const g = globalThis as any;
if (!g.__obsAutoconnect) {
  g.__obsAutoconnect = {
    started: false,
    timer: null,
    connecting: false,
    firstSuccessToastShown: false,
  } as AutoConnectState;
}
const ac: AutoConnectState = g.__obsAutoconnect;

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
};

function attemptConnect() {
  const state = getStore().getState();
  const enabled = state.slippi.autoConnectOBS;
  if (!enabled) {
    return;
  }
  if (ac.connecting) {
    return;
  }
  if (obsConnection.isConnected()) {
    return;
  }

  ac.connecting = true;
  connectToOBS()
    .then(() => {
      if (!ac.firstSuccessToastShown) {
        ac.firstSuccessToastShown = true;
        notifyLazy("Connected to OBS");
      }
      // Connected — stop retries; we'll restart on DISCONNECTED
      stopTimer();
    })
    .catch(() => {
      // silent; next interval will retry
    })
    .finally(() => {
      ac.connecting = false;
    });
}

/**
 * Start observers once per app session / HMR lifetime.
 */
export const startOBSAutoconnectService = (): void => {
  if (ac.started) {
    return;
  }
  ac.started = true;

  // React to connection changes
  obsConnection.connectionStatus$.subscribe((status) => {
    const enabled = getStore().getState().slippi.autoConnectOBS;
    if (status === OBSConnectionStatus.CONNECTED) {
      stopTimer();
    } else if (status === OBSConnectionStatus.DISCONNECTED && enabled) {
      startTimer();
    }
  });

  // React to checkbox changes
  let lastEnabled = getStore().getState().slippi.autoConnectOBS;
  getStore().subscribe(() => {
    const enabled = getStore().getState().slippi.autoConnectOBS;
    if (enabled === lastEnabled) {
      return;
    }
    lastEnabled = enabled;
    if (enabled) {
      if (!obsConnection.isConnected()) {
        startTimer();
      }
    } else {
      stopTimer();
    }
  });

  // Initial boot behavior
  const enabledAtBoot = getStore().getState().slippi.autoConnectOBS;
  if (enabledAtBoot && !obsConnection.isConnected()) {
    startTimer();
  }
};

// Clean up on HMR dispose (Webpack/Electron dev)
if (module && (module as any).hot) {
  (module as any).hot.dispose(() => {
    stopTimer();
    ac.started = false;
    ac.connecting = false;
    // keep firstSuccessToastShown across HMR so we don't re-toast
  });
}
