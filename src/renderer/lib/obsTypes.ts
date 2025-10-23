export enum OBSRecordingAction {
  TOGGLE = "StartStopRecording",
  START = "StartRecording",
  STOP = "StopRecording",
  PAUSE = "PauseRecording",
  UNPAUSE = "ResumeRecording",
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
