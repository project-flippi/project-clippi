import type { RematchRootState } from "@rematch/core";
import { init } from "@rematch/core";
import createRematchPersist, { getPersistor } from "@rematch/persist";

import type { EventConfig } from "@/lib/automator_manager";
import { InputEvent } from "@/lib/automator_manager";
import { dolphinRecorder } from "@/lib/dolphin";
import { mapInputEventConfig } from "@/lib/inputs";
import type { Scene } from "obs-websocket-js";
import { OBSConnectionStatus, OBSRecordingStatus } from "@/lib/obsTypes";
import { mapConfigurationToFilterSettings } from "@/lib/profile";

import { soundPlayer } from "@/lib/sounds";

import * as models from "./models";
import { transformer } from "./transformer";

const getActionsModule = () => require("@/containers/actions");
const getRealtime = () => require("@/lib/realtime");

const persistPlugin = createRematchPersist({
  version: 1,
  blacklist: ["tempContainer"],
  transforms: [transformer],
});

export const store = init({
  models,
  plugins: [persistPlugin],
});

export const dispatcher = store.dispatch;

export const persistor = getPersistor();
export type Store = typeof store;
export type Dispatch = typeof store.dispatch;
export type iRootState = RematchRootState<typeof models>;

export const Models = models;

const storeSync = () => {
  const state = store.getState();

  // Restore actions
  const actions = state.automator.actions;
  getActionsModule().updateEventActionManager(actions);

  // Restore sound files
  const soundFiles = state.filesystem.soundFiles;
  soundPlayer.sounds = soundFiles;

  // Restore combo settings
  const eventConfigVars = {};
  Object.keys(state.slippi.comboProfiles).map((key) => {
    const slippiSettings = state.slippi.comboProfiles[key];
    const converted = mapConfigurationToFilterSettings(JSON.parse(slippiSettings));
    eventConfigVars[`$${key}`] = converted;
  });
  getRealtime().streamManager.updateEventConfig({
    variables: eventConfigVars,
    events: state.automator.events
      .filter((e) => !e.disabled)
      .map(
        (event): EventConfig => {
          const { type, filter } = event;
          switch (type) {
            case InputEvent.BUTTON_COMBO:
              const newButtonConfig = {
                ...event,
                filter: mapInputEventConfig(filter as any),
              };
              return newButtonConfig;
          }
          return event;
        }
      ),
  });
};

store.subscribe(() => {
  setTimeout(storeSync, 0);
});

const obsModule = require("@/lib/obs");
const { obsConnection } = obsModule;

obsConnection.connectionStatus$.subscribe((status: OBSConnectionStatus) => {
  dispatcher.tempContainer.setOBSConnectionStatus(status);
});
obsConnection.recordingStatus$.subscribe((status: OBSRecordingStatus) => {
  dispatcher.tempContainer.setOBSRecordingStatus(status);
});
obsConnection.scenes$.subscribe((scenes: Scene[]) => {
  dispatcher.tempContainer.setOBSScenes(scenes);
});
dolphinRecorder.currentBasename$.subscribe((name) => {
  dispatcher.tempContainer.setDolphinPlaybackFile(name);
});
dolphinRecorder.dolphinRunning$.subscribe((isRunning) => {
  dispatcher.tempContainer.setDolphinRunning(isRunning);
});
