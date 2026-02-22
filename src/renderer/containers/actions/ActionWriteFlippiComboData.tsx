import { writeFile } from "common/utils";
import formatter from "formatter";
import fs from "fs-extra";
import os from "os";
import path from "path";
import * as React from "react";
import { Icon } from "semantic-ui-react";

import type { ActionTypeGenerator, Context } from "@/lib/event_actions";
import { LiveContext } from "@/lib/liveContext";
import { notify as sendNotification } from "@/lib/utils";

import type { ActionComponent } from "./types";

// --- DEDUPE + THROTTLE ---
const lastVersionByFile = new Map<string, number>();
const lastAtByFile = new Map<string, number>();
const MIN_WRITE_INTERVAL_MS = 750;

function shouldWriteForSnapshotAndThrottle(file: string, snapshotVersion: number) {
  const now = Date.now();
  const prevVersion = lastVersionByFile.get(file);
  const prevAt = lastAtByFile.get(file) ?? 0;

  if (prevVersion === snapshotVersion) {
    return false;
  }

  if (now - prevAt < MIN_WRITE_INTERVAL_MS) {
    return false;
  }

  lastVersionByFile.set(file, snapshotVersion);
  lastAtByFile.set(file, now);
  return true;
}

function flippiConfigPath(): string {
  return path.join(os.homedir(), "project-flippi", "flippi-config.json");
}

// The fixed content template for combo data lines
const COMBO_DATA_TEMPLATE = [
  '{"timestamp":"{{YYYY}}-{{MM}}-{{DD}} {{HH}}-{{mm}}-{{ss}}"',
  '"trigger":"filter"',
  '"source":"{{comboSource}}"',
  '"phase":"{{comboPhase}}"',
  '"active":"{{liveHasActiveCombo}}"',
  '"event":{{ComboEventPayload}}}',
].join(",");

async function readFlippiConfig(): Promise<string | null> {
  try {
    const raw = await fs.readFile(flippiConfigPath(), "utf-8");
    const config = JSON.parse(raw);
    return config.comboDataPath || null;
  } catch {
    return null;
  }
}

const actionWriteFlippiComboData: ActionTypeGenerator = () => {
  return async (ctx: Context): Promise<Context> => {
    try {
      const comboDataPath = await readFlippiConfig();
      if (!comboDataPath) {
        return ctx;
      }

      const liveCtx = LiveContext.getSnapshot();
      const snapshotVersion = Number((liveCtx as Record<string, unknown>).liveLastUpdatedAt) || 0;
      if (!shouldWriteForSnapshotAndThrottle(comboDataPath, snapshotVersion)) {
        return ctx;
      }

      const msgFormatter = formatter(COMBO_DATA_TEMPLATE);
      const formattedContent = msgFormatter(liveCtx);
      await writeFile(formattedContent, comboDataPath, true);
    } catch (err) {
      console.error(err);
      sendNotification("Failed to write Flippi combo data");
    }
    return ctx;
  };
};

const ActionIcon = () => {
  return <Icon name="game" size="large" />;
};

const NoConfigMessage = () => {
  return (
    <div style={{ color: "#888", fontStyle: "italic" }}>
      This action reads the target file from Flippi automatically. No configuration needed.
    </div>
  );
};

export const ActionWriteFlippiComboData: ActionComponent = {
  label: "write Flippi combo data",
  action: actionWriteFlippiComboData,
  Icon: ActionIcon,
  Component: NoConfigMessage,
};
