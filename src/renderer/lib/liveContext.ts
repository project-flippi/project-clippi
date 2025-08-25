import type { ComboType, GameStartType } from "@slippi/slippi-js";
import type { SlpRealTime } from "@vinceau/slp-realtime";
import type { ComboEventPayload } from "@vinceau/slp-realtime";
import { generateComboContext, generateGameStartContext, generateGlobalContext } from "common/context";
import type { Subscription } from "rxjs";

import type { Context } from "@/lib/event_actions";

type ComboPhase = "combo-start" | "combo-extend" | "combo-end" | "conversion" | "none";
type ComboSource = "combo" | "conversion" | "none";

class LiveContextService {
  private realtime: SlpRealTime | null = null;
  private subs: Subscription[] = [];

  private lastSettings: GameStartType | undefined;
  private activeCombo: ComboType | undefined;
  private lastFinishedCombo: ComboType | undefined;
  private lastComboSettings: GameStartType | undefined;

  private lastUpdatedAt = 0;

  private activePayload: ComboEventPayload | undefined;
  private activePayloadKind: ComboPhase = "none";
  private activePayloadCategory: ComboSource = "none";

  private lastFinishedPayload: ComboEventPayload | undefined;
  private lastFinishedPayloadKind: ComboPhase = "none";
  private lastFinishedPayloadCategory: ComboSource = "none";

  public start(realtime: SlpRealTime) {
    if (this.realtime === realtime && this.subs.length > 0) {
      console.log("[LiveContext] start(): already running; no-op");
      return;
    }
    this.stop(); // safety: clear prior subs if any
    this.realtime = realtime;

    console.log("[LiveContext] start(): subscribing to realtime streams", new Date().toISOString());

    // --- GAME START ---
    const gsSub = (realtime as any).game?.start$?.subscribe?.((settings: GameStartType) => {
      this.lastSettings = settings;
      this.lastUpdatedAt = Date.now();
      this.activeCombo = undefined;
      this.activePayload = undefined;
      this.activePayloadKind = "none";
      this.activePayloadCategory = "none";
    });

    // --- COMBO START ---
    const cStartSub = (realtime as any).combo?.start$?.subscribe?.((ev: ComboEventPayload) => {
      this.activeCombo = ev.combo;
      this.lastComboSettings = ev.settings;
      this.activePayload = ev;
      this.activePayloadKind = "combo-start";
      this.activePayloadCategory = "combo";
      this.lastUpdatedAt = Date.now();
    });

    // --- COMBO EXTEND ---
    const cExtendSub = (realtime as any).combo?.extend$?.subscribe?.((ev: ComboEventPayload) => {
      this.activeCombo = ev.combo; // keep the latest state of the active combo
      this.lastComboSettings = ev.settings;
      this.activePayload = ev;
      this.activePayloadKind = "combo-extend";
      this.activePayloadCategory = "combo";
      this.lastUpdatedAt = Date.now();
    });

    // --- COMBO END ---
    const cEndSub = (realtime as any).combo?.end$?.subscribe?.((ev: ComboEventPayload) => {
      // retain last finished combo until a new one starts
      this.lastFinishedCombo = ev.combo;
      this.lastComboSettings = ev.settings;
      this.lastFinishedPayload = ev;
      this.lastFinishedPayloadKind = "combo-end";
      this.lastFinishedPayloadCategory = "combo";

      this.activePayload = undefined;
      this.activeCombo = undefined;
      this.activePayloadKind = "none";
      this.activePayloadCategory = "none";

      this.lastUpdatedAt = Date.now();
    });

    // --- CONVERSION (optional retention of “last notable combo-like event”) ---
    const cConvSub = (realtime as any).combo?.conversion$?.subscribe?.((ev: ComboEventPayload) => {
      // Treat conversions as “last notable sequence” if no active combo;
      // This keeps templates populated during idle gaps.
      if (!this.activeCombo) {
        this.lastFinishedCombo = ev.combo;
        this.lastComboSettings = ev.settings;
        this.lastFinishedPayload = ev;
        this.lastFinishedPayloadKind = "conversion";
        this.lastFinishedPayloadCategory = "conversion";
        this.lastUpdatedAt = Date.now();
      }
    });

    for (const s of [gsSub, cStartSub, cExtendSub, cEndSub, cConvSub]) {
      if (s && typeof (s as Subscription).unsubscribe === "function") {
        this.subs.push(s as Subscription);
      }
    }
  }

  public stop() {
    if (this.subs.length > 0) {
      console.log("[LiveContext] stop(): unsubscribing", new Date().toISOString());
    }
    for (const s of this.subs) {
      try {
        s.unsubscribe();
      } catch {}
    }
    this.subs = [];
    // keep lastFinishedCombo and lastSettings by design (so context can still be read),
    // but clear active combo and detach realtime reference.
    this.activeCombo = undefined;
    this.activePayload = undefined;
    this.activePayloadKind = "none";
    this.activePayloadCategory = "none";
    this.realtime = null;
  }

  private buildAllPlayersOverlay(settings?: GameStartType): Context {
    const overlay: Context = {};
    if (!settings?.players?.length) {
      return overlay;
    }

    for (const p of settings.players) {
      const perCtx = generateGameStartContext(settings, {}, p.playerIndex);
      const port = (p as any)?.port ?? (perCtx as any)?.playerPort ?? undefined;
      if (!port) {
        continue;
      }

      overlay[`p${port}Port`] = port as any;
      overlay[`p${port}Tag`] = (perCtx as any)?.playerTag ?? p.nametag ?? null;
      overlay[`p${port}Char`] = (perCtx as any)?.playerChar ?? null;
      overlay[`p${port}ShortChar`] = (perCtx as any)?.playerShortChar ?? null;
      overlay[`p${port}Color`] = (perCtx as any)?.playerColor ?? null;
      overlay[`p${port}Index`] = p.playerIndex as any;
    }
    return overlay;
  }

  public getSnapshot(): Context {
    let base: Context = {};
    if (this.activeCombo && this.lastSettings) {
      base = generateComboContext(this.activeCombo, this.lastSettings, {});
    } else if (this.lastFinishedCombo && this.lastComboSettings) {
      base = generateComboContext(this.lastFinishedCombo, this.lastComboSettings, {});
    } else if (this.lastSettings) {
      base = generateGameStartContext(this.lastSettings, {});
    }

    const hasActiveCombo = Boolean(this.activeCombo);
    const overlay = !hasActiveCombo ? this.buildAllPlayersOverlay(this.lastSettings) : {};

    const payload = this.activePayload ?? this.lastFinishedPayload;
    const payloadSource: ComboSource = this.activePayload
      ? this.activePayloadCategory
      : this.lastFinishedPayload
      ? this.lastFinishedPayloadCategory
      : "none";
    const payloadPhase: ComboPhase = this.activePayload
      ? this.activePayloadKind
      : this.lastFinishedPayload
      ? this.lastFinishedPayloadKind
      : "none";

    const overlayPayload = payload
      ? {
          ComboEventPayload: JSON.stringify(payload), // compact
          ComboEventPayloadPretty: JSON.stringify(payload, null, 2), // pretty, multiline
          comboSource: payloadSource,
          comboPhase: payloadPhase,
        }
      : {
          ComboEventPayload: "",
          ComboEventPayloadPretty: "",
          comboSource: "none",
          comboPhase: "none",
        };

    const tokenCtx = generateGlobalContext({}); // tokens only
    const snapshot: Context = {
      ...base,
      ...overlay,
      ...overlayPayload,

      liveHasActiveCombo: hasActiveCombo ? "yes" : "no",
      liveLastUpdatedAt: this.lastUpdatedAt,
      ...tokenCtx,
    };

    console.log("[LiveContext] snapshot", {
      keys: Object.keys(snapshot).length,
      hasStage: Boolean((snapshot as any).stage),
      hasPlayerChar: Boolean((snapshot as any).playerChar),
      hasComboPercent: "comboPercent" in snapshot,
    });

    return snapshot;
  }
}

export const LiveContext = new LiveContextService();
