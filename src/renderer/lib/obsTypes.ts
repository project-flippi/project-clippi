export enum OBSRecordingAction {
  TOGGLE = "ToggleRecord",
  START = "StartRecord",
  STOP = "StopRecord",
  PAUSE = "PauseRecord",
  UNPAUSE = "ResumeRecord",
}

export enum OBSRecordingStatus {
  RECORDING = "RECORDING",
  PAUSED = "PAUSED",
  STOPPED = "STOPPED",
}

export enum OBSConnectionStatus {
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
}

export interface OBSSceneItem {
  sceneItemId: number;
  sourceName: string;
  sceneItemEnabled: boolean;
}

export interface OBSSceneWithItems {
  sceneName: string;
  sceneIndex: number;
  items: OBSSceneItem[];
}
