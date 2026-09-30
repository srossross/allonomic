import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import type { TabData } from "@/types";
import type { TurnEvent } from "@/core/turn/events";
import type { QueuedPrompt } from "@/core/graph/turnControl";
import { didDequeuePromptApi, enqueuePromptApi, pauseAgentApi, resumeAgentApi } from "@/agent/api";
import { withAlert } from "@/lib/alertError";

interface QueueState {
  prompts: QueuedPrompt[];
  pauseState?: "pausing" | "paused";
  isHeld: boolean;
  isRunning: boolean;
}

export type StartTurn = (
  tab: TabData,
  text: string,
  onTurnEvent: (event: TurnEvent) => void
) => Promise<void>;

export function useTurnQueue(setTabs: Dispatch<SetStateAction<TabData[]>>, startTurn: StartTurn) {
  const store = useRef(new Map<string, QueueState>());
  const flushRef = useRef<(tab: TabData) => Promise<void>>(async () => {});

  const stateOf = useCallback((tabId: string): QueueState => {
    let state = store.current.get(tabId);
    if (!state) {
      state = { prompts: [], isHeld: false, isRunning: false };
      store.current.set(tabId, state);
    }
    return state;
  }, []);

  const update = useCallback(
    (tabId: string, patch: Partial<QueueState>) => {
      const state = Object.assign(stateOf(tabId), patch);
      setTabs((previous) =>
        previous.map((t) =>
          t.id === tabId
            ? {
                ...t,
                queuedPrompts: state.prompts,
                pauseState: state.pauseState,
                queueHeld: state.isHeld,
              }
            : t
        )
      );
    },
    [setTabs, stateOf]
  );

  const onTurnEvent = useCallback(
    (tabId: string, event: TurnEvent) => {
      const state = stateOf(tabId);
      switch (event.type) {
        case "paused": {
          update(tabId, { pauseState: "paused" });
          break;
        }
        case "resumed": {
          update(tabId, { pauseState: undefined });
          break;
        }
        case "prompt_delivered": {
          update(tabId, { prompts: state.prompts.filter((p) => p.id !== event.queueId) });
          break;
        }
        default:
      }
    },
    [stateOf, update]
  );

  const run = useCallback(
    async (tab: TabData, text: string): Promise<void> => {
      update(tab.id, { isRunning: true });
      try {
        await startTurn(tab, text, (event) => onTurnEvent(tab.id, event));
      } finally {
        const state = stateOf(tab.id);
        update(tab.id, {
          isRunning: false,
          pauseState: state.pauseState && "paused",
          prompts: [...state.prompts],
        });
      }
      const state = stateOf(tab.id);
      if (!state.pauseState && !state.isHeld && state.prompts.length > 0)
        await flushRef.current(tab);
    },
    [startTurn, onTurnEvent, stateOf, update]
  );

  const flush = useCallback(
    async (tab: TabData, extra?: string) => {
      const texts = [...stateOf(tab.id).prompts.map((p) => p.text), ...(extra ? [extra] : [])];
      update(tab.id, { prompts: [], isHeld: false, pauseState: undefined });
      if (texts.length > 0) await run(tab, texts.join("\n\n"));
    },
    [run, stateOf, update]
  );
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const send = useCallback(
    (tab: TabData, text: string) => {
      const state = stateOf(tab.id);
      if (!state.isRunning) {
        void withAlert("Send message", () => run(tab, text));
        return;
      }
      const prompt = { id: nanoid(), text };
      update(tab.id, { prompts: [...state.prompts, prompt] });
      enqueuePromptApi(tab.threadId, tab.id, prompt);
    },
    [run, stateOf, update]
  );

  const pause = useCallback(
    (tab: TabData) => {
      if (!stateOf(tab.id).isRunning) return;
      update(tab.id, { pauseState: "pausing" });
      pauseAgentApi(tab.threadId, tab.id);
    },
    [stateOf, update]
  );

  const resume = useCallback(
    (tab: TabData, text: string) => {
      if (!stateOf(tab.id).isRunning) {
        void withAlert("Resume", () => flush(tab, text || undefined));
        return;
      }
      if (text) send(tab, text);
      update(tab.id, { pauseState: undefined });
      resumeAgentApi(tab.threadId, tab.id);
    },
    [flush, send, stateOf, update]
  );

  const hold = useCallback(
    (tab: TabData) => {
      update(tab.id, { pauseState: undefined, isHeld: stateOf(tab.id).prompts.length > 0 });
    },
    [stateOf, update]
  );

  const didRemove = useCallback(
    (tab: TabData, id: string): boolean => {
      const state = stateOf(tab.id);
      if (state.isRunning && !didDequeuePromptApi(tab.threadId, tab.id, id)) return false;
      update(tab.id, { prompts: state.prompts.filter((p) => p.id !== id) });
      return true;
    },
    [stateOf, update]
  );

  const pop = useCallback(
    (tab: TabData): string | undefined => {
      const last = stateOf(tab.id).prompts.at(-1);
      return last && didRemove(tab, last.id) ? last.text : undefined;
    },
    [didRemove, stateOf]
  );

  return { run, send, pause, resume, hold, didRemove, pop };
}
