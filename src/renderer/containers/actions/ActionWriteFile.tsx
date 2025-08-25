import { writeFile } from "common/utils";
import formatter from "formatter";
import { produce } from "immer";
import * as React from "react";
import { Form, Icon, TextArea } from "semantic-ui-react";

import { FileInput } from "@/components/FileInput";
import { InlineDropdown } from "@/components/InlineInputs";
import type { ActionTypeGenerator, Context } from "@/lib/event_actions";
import { LiveContext } from "@/lib/liveContext";
import { notify as sendNotification } from "@/lib/utils";

import type { ActionComponent } from "./types";

// --- DEDUPE + THROTTLE ---
const lastVersionByFile = new Map<string, number>();
const lastAtByFile = new Map<string, number>();
const MIN_WRITE_INTERVAL_MS = 750; // tweak: 500–1000ms usually good

function shouldWriteForSnapshotAndThrottle(file: string, snapshotVersion: number) {
  const now = Date.now();
  const prevVersion = lastVersionByFile.get(file);
  const prevAt = lastAtByFile.get(file) ?? 0;

  // one write per snapshot
  if (prevVersion === snapshotVersion) {
    return false;
  }

  // hard throttle per file
  if (now - prevAt < MIN_WRITE_INTERVAL_MS) {
    return false;
  }

  lastVersionByFile.set(file, snapshotVersion);
  lastAtByFile.set(file, now);
  return true;
}

interface ActionWriteFileParams {
  content: string;
  outputFileName?: string;
  append?: boolean;
}

const defaultParams = (): ActionWriteFileParams => {
  return {
    content: "",
    outputFileName: "",
    append: false,
  };
};

const actionWriteFile: ActionTypeGenerator = (params: ActionWriteFileParams) => {
  return async (ctx: Context): Promise<Context> => {
    const { content, outputFileName, append } = params;
    if (content && outputFileName) {
      try {
        const liveCtx = LiveContext.getSnapshot();
        const msgFormatter = formatter(content);
        const formattedContent = msgFormatter(liveCtx);
        const formattedFilename = formatter(outputFileName)(liveCtx);

        const snapshotVersion = (liveCtx as any).liveLastUpdatedAt ?? 0;
        if (!shouldWriteForSnapshotAndThrottle(formattedFilename, snapshotVersion)) {
          return ctx;
        }
        await writeFile(formattedContent, formattedFilename, append);
      } catch (err) {
        console.error(err);
        sendNotification(`Failed to write to file`);
      }
    }
    return ctx;
  };
};

const ActionIcon = () => {
  return <Icon name="file alternate" size="large" />;
};

interface WriteFileProps extends Record<string, any> {
  value: ActionWriteFileParams;
  onChange(value: ActionWriteFileParams): void;
}

const WriteFileInput = (props: WriteFileProps) => {
  const { value, onChange } = props;
  const defaultValue = value && value.content ? value.content : "";
  const [msg, setMsg] = React.useState(defaultValue);
  const onContentChange = () => {
    const newValue = produce(value, (draft) => {
      draft.content = msg;
    });
    onChange(newValue);
  };
  const onAppendChange = (append: boolean) => {
    const newValue = produce(value, (draft) => {
      draft.append = append;
    });
    onChange(newValue);
  };
  const onOutputFileChange = (name: string) => {
    const newValue = produce(value, (draft) => {
      draft.outputFileName = name;
    });
    onChange(newValue);
  };
  return (
    <div>
      <div style={{ paddingBottom: "5px" }}>
        <InlineDropdown
          value={Boolean(value.append)}
          onChange={onAppendChange}
          options={[
            {
              key: "write",
              value: false,
              text: "Write",
            },
            {
              key: "append",
              value: true,
              text: "Append",
            },
          ]}
        />
        {" the following:"}
      </div>
      <Form>
        <TextArea
          onBlur={onContentChange}
          value={msg}
          onChange={(_: any, { value }: any) => setMsg(value)}
          placeholder="Hmmm.. What should I write?"
        />
      </Form>
      <div style={{ padding: "5px 0" }}>To the file:</div>
      <FileInput value={value.outputFileName || ""} onChange={onOutputFileChange} saveFile={true} />
    </div>
  );
};

export const ActionWriteFile: ActionComponent = {
  label: "write to a file",
  action: actionWriteFile,
  Icon: ActionIcon,
  Component: WriteFileInput,
  defaultParams,
};
