import { ConnectionStatus } from "@slippi/slippi-js";
import * as React from "react";
import { useSelector } from "react-redux";
import { useHistory } from "react-router-dom";

import { ConnectionStatusDisplay } from "@/components/ConnectionStatusDisplay";
import { statusToColor, statusToLabel } from "@/lib/status";
import type { iRootState } from "@/store";
import slippiLogo from "@/styles/images/slippi.png";

export const StatusBar: React.FC = () => {
  const history = useHistory();

  const port = useSelector((state: iRootState) => state.slippi.port);
  const slippiConnectionStatus = useSelector((state: iRootState) => state.tempContainer.slippiConnectionStatus);
  const slippiConnectionType = useSelector((state: iRootState) => state.tempContainer.slippiConnectionType);

  const autoConnectDolphin = useSelector((state: iRootState) => state.slippi.autoConnectDolphin);

  const connected = slippiConnectionStatus === ConnectionStatus.CONNECTED;
  const isDolphinConnection = slippiConnectionType === "dolphin";
  const isConnecting =
    slippiConnectionStatus === ConnectionStatus.CONNECTING ||
    slippiConnectionStatus === ConnectionStatus.RECONNECT_WAIT;
  const headerText = statusToLabel(slippiConnectionStatus);
  const innerText = connected
    ? isDolphinConnection
      ? "Slippi Dolphin"
      : `Relay Port: ${port}`
    : isConnecting
    ? "Attempting to connect to Slippi Dolphin"
    : autoConnectDolphin
    ? "Waiting to connect to Slippi Dolphin"
    : "Please connect to Slippi";
  const color = statusToColor(slippiConnectionStatus);
  return (
    <div>
      <ConnectionStatusDisplay
        icon={slippiLogo}
        iconHoverText="Open Slippi settings"
        onIconClick={() => history.push("/settings/slippi-settings")}
        headerText={headerText}
        shouldPulse={connected}
        color={color}
      >
        {innerText}
      </ConnectionStatusDisplay>
    </div>
  );
};
