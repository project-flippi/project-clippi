import { ConnectionEvent, ConnectionStatus } from "@slippi/slippi-js";
import { SlpFolderStream, SlpLiveStream, SlpRealTime } from "@vinceau/slp-realtime";
import log from "electron-log";

import { LiveContext } from "@/lib/liveContext";
import { dispatcher } from "@/store";

import { eventActionManager } from "../containers/actions";
import type { EventManagerConfig } from "./automator_manager";
import { EventManager } from "./automator_manager";
import { notify } from "./utils";

import { merge, Subscription } from "rxjs";
import { sampleTime } from "rxjs/operators";

class SlpStreamManager {
  private stream: SlpLiveStream | SlpFolderStream | null = null;
  private realtime: SlpRealTime;
  private eventManager: EventManager;
  private inputDebugSub?: Subscription;
  private inputProbeSub?: Subscription;
  private rawProbeSub?: Subscription;

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
    const stream = new SlpLiveStream(type);
    stream.connection.on(ConnectionEvent.ERROR, (err) => {
      log.error(err);
    });
    stream.connection.once(ConnectionEvent.CONNECT, () => {
      dispatcher.tempContainer.setSlippiConnectionType(type);
      const connType = type === "dolphin" ? "Slippi Dolphin" : "Slippi relay";
      stream.connection.on(ConnectionEvent.STATUS_CHANGE, (status: ConnectionStatus) => {
        dispatcher.tempContainer.setSlippiConnectionStatus(status);
        if (status === ConnectionStatus.CONNECTED) {
          notify(`Connected to ${connType}`);
        } else if (status === ConnectionStatus.DISCONNECTED) {
          notify(`Disconnected from ${connType}`);
        }
      });
    });

    console.log(stream.connection);
    await stream.start(address, slpPort);
    this.realtime.setStream(stream);
    this.stream = stream;
    console.log("[RealTimeInputEvents instance]", this.realtime.input);
    console.log("[RealTimeInputEvents instance]", this.realtime.input);
    try {
      // Clean old probe if reconnecting
      this.inputProbeSub?.unsubscribe();

      const subs: Subscription[] = [];

      // 1) INPUT ACTIVITY: listen for a few single-button combos
      const inputSubs = [
        this.realtime.input.buttonCombo(["A"], 1).subscribe((evt) => {
          // evt: { frame, playerIndex, combo, duration }
          console.log("[Probe][Input] A", evt);
        }),
        this.realtime.input.buttonCombo(["B"], 1).subscribe((evt) => {
          console.log("[Probe][Input] B", evt);
        }),
        this.realtime.input.buttonCombo(["D_DOWN"], 1).subscribe((evt) => {
          console.log("[Probe][Input] D_DOWN", evt);
        }),
      ];
      subs.push(...inputSubs);

      // 2) GAME HEARTBEAT: prove realtime is wired to the stream
      subs.push(
        this.realtime.game.start$.subscribe((g) => {
          console.log("[Probe][Game] start$", g);
        })
      );
      subs.push(
        this.realtime.game.end$.subscribe((g) => {
          console.log("[Probe][Game] end$", g);
        })
      );

      // Group them under one handle for teardown
      this.inputProbeSub = new Subscription();
      for (const sub of subs) this.inputProbeSub.add(sub);

      console.log("[Probe] Attached input/game/frame activity probes");
    } catch (e) {
      console.warn("[Probe] Failed to attach probes:", e);
    }
    try {
      this.rawProbeSub?.unsubscribe();

      const subs: Subscription[] = [];

      // 1) Message size (bytes flowing at all)
      subs.push(
        stream.messageSize$.pipe(sampleTime(1000)).subscribe((size) => {
          console.log("[Raw][MsgSize]", size);
        })
      );

      // 2) Game lifecycle
      subs.push(
        stream.gameStart$.subscribe((g) => {
          console.log("[Raw][Game] start$", g);
        })
      );
      subs.push(
        stream.gameEnd$.subscribe((g) => {
          console.log("[Raw][Game] end$", g);
        })
      );

      // 3) Player frame pulse
      subs.push(
        stream.playerFrame$.pipe(sampleTime(500)).subscribe(() => {
          console.log("[Raw][PlayerFrame] tick");
        })
      );

      // 4) All frames sample
      subs.push(
        stream.allFrames$.pipe(sampleTime(500)).subscribe((fr: any) => {
          const p0 = fr?.latestFrame?.players?.[0]?.pre;
          const p1 = fr?.latestFrame?.players?.[1]?.pre;
          console.log("[Raw][AllFrames]", {
            hasP0: !!p0,
            hasP1: !!p1,
            p0ButtonsPresent: p0?.buttons != null,
            p1ButtonsPresent: p1?.buttons != null,
          });
        })
      );

      this.rawProbeSub = new Subscription();
      for (const s of subs) this.rawProbeSub.add(s);

      console.log("[Raw][Attach] probes attached");
    } catch (e) {
      console.warn("[Raw][Attach] failed", e);
    }

    try {
      // Example: listen for a single-button "A" press held for 1 frame.
      this.inputDebugSub?.unsubscribe(); // in case we reconnect
      this.inputDebugSub = this.realtime.input.buttonCombo(["A"], 1).subscribe((evt) => {
        // evt is InputButtonCombo: { frame, playerIndex, combo, duration }
        console.log("[InputDebug] buttonCombo A", evt);
      });

      // (Optional) Add one more common button to prove multiple work:
      const sub2 = this.realtime.input.buttonCombo(["D_DOWN"], 1).subscribe((evt) => {
        console.log("[InputDebug] buttonCombo DDOWN", evt);
      });

      // Track both under one handle for easy cleanup
      this.inputDebugSub.add(sub2);

      console.log("[InputDebug] subscriptions active");
    } catch (e) {
      console.warn("[InputDebug] failed to attach:", e);
    }

    try {
      console.log("[LiveContext] realtime.ts → start() after stream set", new Date().toISOString());
      LiveContext.start(this.realtime);
    } catch (e) {
      console.warn("[LiveContext] start() threw:", e);
    }
  }

  public disconnectFromSlippi(): void {
    if (this.stream && "connection" in this.stream) {
      this.stream.connection.disconnect();
    }
    this.stream = null;
    this.inputDebugSub?.unsubscribe();
    this.inputDebugSub = undefined;
    this.inputProbeSub?.unsubscribe();
    this.inputProbeSub = undefined;
    this.rawProbeSub?.unsubscribe();
    this.rawProbeSub = undefined;
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
      dispatcher.tempContainer.setSlpFolderStream(filepath);
      try {
        // Example: listen for a single-button "A" press held for 1 frame.
        this.inputDebugSub?.unsubscribe(); // in case we reconnect
        this.inputDebugSub = this.realtime.input.buttonCombo(["A"], 1).subscribe((evt) => {
          // evt is InputButtonCombo: { frame, playerIndex, combo, duration }
          console.log("[InputDebug] buttonCombo A", evt);
        });

        // (Optional) Add one more common button to prove multiple work:
        const sub2 = this.realtime.input.buttonCombo(["D_DOWN"], 1).subscribe((evt) => {
          console.log("[InputDebug] buttonCombo DDOWN", evt);
        });

        // Track both under one handle for easy cleanup
        this.inputDebugSub.add(sub2);

        console.log("[InputDebug] subscriptions active");
      } catch (e) {
        console.warn("[InputDebug] failed to attach:", e);
      }

      try {
        console.log("[LiveContext] realtime.ts → start() after stream set", new Date().toISOString());
        LiveContext.start(this.realtime);
      } catch (e) {
        console.warn("[LiveContext] start() threw:", e);
      }
    } catch (err) {
      console.error(err);
      notify("Could not monitor folder. Are you sure it exists?");
    }
  }

  public stopMonitoringSlpFolder(): void {
    if (this.stream && "stop" in this.stream) {
      this.stream.stop();
    }
    this.stream = null;
    this.inputDebugSub?.unsubscribe();
    this.inputDebugSub = undefined;
    dispatcher.tempContainer.clearSlpFolderStream();
    this.inputProbeSub?.unsubscribe();
    this.inputProbeSub = undefined;
    this.rawProbeSub?.unsubscribe();
    this.rawProbeSub = undefined;
    try {
      console.log("[LiveContext] realtime.ts → stop() on stream clear/teardown", new Date().toISOString());
      LiveContext.stop();
    } catch (e) {
      console.warn("[LiveContext] stop() threw:", e);
    }
  }
}

export const streamManager = new SlpStreamManager();

//Construct and export the context
export const eventManagerCtx = {
  eventManager: streamManager.getEventManager(),
};
