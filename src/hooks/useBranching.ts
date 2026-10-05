import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TabData } from "@/types";
import {
  fetchSessionSettingsApi,
  forkSessionApi,
  rehydrateSessionApi,
  rewindSessionApi,
} from "@/agent/api";
import { EMPTY_TURN_TREE, parentOf, type TurnHead } from "@/core/turn/branches";
import { rehydratedToTab } from "./rehydratedTab";
import { settingsToTab } from "./tabSettings";

interface UseBranchingParameters {
  activeTab: TabData;
  projectPath?: string;
  tabsRef: RefObject<TabData[]>;
  setTabs: Dispatch<SetStateAction<TabData[]>>;
  setActiveTabId: (id: string) => void;
  persistTabSwitch: (tabId: string, allTabs: TabData[]) => void;
}

function promptAt(tab: TabData, turnIndex: number) {
  const prompt = tab.messages.find((m) => m.turnIndex === turnIndex)?.content ?? "";
  return { prompt, head: parentOf(tab.turnTree ?? EMPTY_TURN_TREE, turnIndex) };
}

export function useBranching({
  activeTab,
  projectPath,
  tabsRef,
  setTabs,
  setActiveTabId,
  persistTabSwitch,
}: UseBranchingParameters) {
  const rewindTo = useCallback(
    async (tab: TabData, head: TurnHead, draft?: string) => {
      if (!projectPath) return;
      const rehydrated = await rewindSessionApi(projectPath, tab.id, head);
      setTabs((previous) =>
        previous.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                ...rehydratedToTab(rehydrated),
                draft: draft === undefined ? t.draft : { text: draft, nonce: Date.now() },
              }
            : t
        )
      );
    },
    [projectPath, setTabs]
  );

  const handleRewind = useCallback(
    (turnIndex: number) => {
      const { prompt, head } = promptAt(activeTab, turnIndex);
      return rewindTo(activeTab, head, prompt);
    },
    [activeTab, rewindTo]
  );

  const handleSwitchBranch = useCallback(
    (head: TurnHead) => rewindTo(activeTab, head),
    [activeTab, rewindTo]
  );

  const handleFork = useCallback(
    async (turnIndex: number) => {
      if (!projectPath) return;
      const source = activeTab;
      const { prompt, head } = promptAt(source, turnIndex);
      const forkId = await forkSessionApi(projectPath, source.id, head);
      const rehydrated = await rehydrateSessionApi(projectPath, forkId);
      const settings = await fetchSessionSettingsApi(projectPath, forkId);
      const forkTab: TabData = {
        id: forkId,
        title: rehydrated.metadata.title,
        projectId: source.projectId,
        threadId: forkId,
        ...rehydratedToTab(rehydrated),
        loading: false,
        ...settingsToTab(settings),
        draft: { text: prompt, nonce: Date.now() },
      };
      const insertAfter = (list: TabData[]) =>
        list.toSpliced(list.findIndex((t) => t.id === source.id) + 1, 0, forkTab);
      const projectTabs = tabsRef.current.filter((t) => t.projectId === source.projectId);
      setTabs(insertAfter);
      setActiveTabId(forkId);
      persistTabSwitch(forkId, insertAfter(projectTabs));
    },
    [activeTab, projectPath, tabsRef, setTabs, setActiveTabId, persistTabSwitch]
  );

  return { handleRewind, handleSwitchBranch, handleFork };
}
