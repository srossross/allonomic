import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TabData } from "@/types";
import {
  createDetachedTurnEvent,
  type TurnEvent,
  type TurnEventListener,
} from "@/core/turn/events";
import { applyTurnEvent } from "@/core/turn/transcript";
import { EMPTY_PROFILE } from "@/core/turn/profile";

function isTerminal(event: TurnEvent): boolean {
  return event.type === "turn_completed" || event.type === "turn_failed";
}

function applyTurnEventToTab(tab: TabData, event: TurnEvent): TabData {
  const next = applyTurnEvent(
    {
      messages: tab.messages,
      contextMessages: tab.contextMessages ?? [],
      consoleEvents: tab.consoleEvents ?? [],
      agentFiles: tab.agentFiles ?? [],
      governorState: tab.governorState,
      contextTokens: tab.contextTokens,
      waitingOn: tab.waitingOn,
      profile: tab.profile ?? EMPTY_PROFILE,
    },
    event
  );
  return { ...tab, ...next, loading: !isTerminal(event) && tab.loading };
}

export type RunTurn = (
  tabId: string,
  call: (onEvent: TurnEventListener) => Promise<unknown>
) => Promise<void>;

export function useTurnDispatch(
  setTabs: Dispatch<SetStateAction<TabData[]>>,
  activeTabIdRef: RefObject<string>
): RunTurn {
  return useCallback(
    async (tabId, call) => {
      let isSettled = false;
      const onEvent: TurnEventListener = (event) => {
        if (isTerminal(event)) isSettled = true;
        setTabs((previous) =>
          previous.map((t) => (t.id === tabId ? applyTurnEventToTab(t, event) : t))
        );
      };

      try {
        await call(onEvent);
      } catch (error: unknown) {
        if (!isSettled) {
          onEvent(
            createDetachedTurnEvent({
              type: "turn_failed",
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              aborted: error instanceof Error && error.name === "AbortError",
            })
          );
        }
      } finally {
        setTabs((previous) =>
          previous.map((t) =>
            t.id === tabId
              ? { ...t, loading: false, hasUnread: t.id !== activeTabIdRef.current }
              : t
          )
        );
      }
    },
    [setTabs, activeTabIdRef]
  );
}
