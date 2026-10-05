import { useState, useEffect, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProjectsSidebar } from "@/components/sidebar/ProjectsSidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { TabLoadErrorBanner } from "@/components/tabs/TabLoadErrorBanner";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { composerPhase } from "@/components/chat/composerPhase";
import { IntentsPanel } from "@/components/inspector/IntentsPanel";
import { useTabsManager } from "@/hooks/useTabsManager";
import { usePromptResponses } from "@/hooks/usePromptResponses";
import { useProjectManager } from "@/hooks/useProjectManager";
import { didBackgroundToolCallApi, didStopToolCallApi, fetchModelsApi } from "@/agent/api";
import { SessionJobs } from "@/components/jobs/SessionJobs";
import { withAlert } from "@/lib/alertError";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_GOVERNOR_MODE,
  DEFAULT_MODEL_ID,
  INITIAL_TOOLS,
  type ModelOption,
} from "@/types";

function App() {
  const [models, setModels] = useState<ModelOption[]>([]);

  const newTabRef = useRef<() => void>(() => {});

  const {
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    handleRenameProject,
    handleDeleteProject,
    groups,
    handleCreateGroup,
    handleUpdateGroup,
    handleDeleteGroup,
    handleSetProjectGroup,
    triggerDirPicker,
  } = useProjectManager(() => newTabRef.current());

  useEffect(() => {
    let isCancelled = false;
    async function loadModels() {
      const loaded = await fetchModelsApi(activeProject?.path);
      if (!isCancelled) setModels(loaded);
    }
    void withAlert("Load models", loadModels);
    return () => {
      isCancelled = true;
    };
  }, [activeProject?.path]);

  const {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    handleNewTab,
    handleCloseTab,
    handleSelectModel,
    handleSelectThinkingLevel,
    handleSelectExecutionMode,
    handleCycleExecutionMode,
    handleToggleHasNetworkAccess,
    handleToggleTeacher,
    handleSetInterceptorSettings,
    handleCycleGovernorMode,
    handleSendMessage,
    handleStopMessage,
    handlePause,
    handleResume,
    handleRemoveQueued,
    handlePopQueued,
    handleRetry,
    handleRewind,
    handleSwitchBranch,
    handleFork,
    handleClearConsole,
    handleToggleContext,
    handleToggleTool,
    handleSetAllTools,
    handleSettingsSaved,
  } = useTabsManager(activeProject);

  const { handleRespondToPrompt } = usePromptResponses({ activeProject, activeTab });

  useEffect(() => {
    newTabRef.current = handleNewTab;
  }, [handleNewTab]);

  const closeActiveTabRef = useRef(() => {});
  useEffect(() => {
    const unlisten = listen("close-tab", () => closeActiveTabRef.current());
    void withAlert("Listen for close-tab", () => unlisten);
    return () => {
      void withAlert("Stop listening for close-tab", async () => (await unlisten)());
    };
  }, []);

  const projectStates = useMemo(() => {
    const states: Record<
      string,
      { agentState: "idle" | "running" | "awaiting"; hasUnread: boolean }
    > = {};
    for (const proj of projects) {
      const projTabs = tabs.filter((t) => t.projectId === proj.id);
      const isRunning = projTabs.some((t) => t.loading);
      const hasUnread = projTabs.some((t) => t.hasUnread);
      states[proj.id] = {
        agentState: isRunning ? "running" : hasUnread ? "awaiting" : "idle",
        hasUnread,
      };
    }
    return states;
  }, [projects, tabs]);

  const activeProjectTabs = useMemo(
    () => tabs.filter((t) => t.projectId === activeProject?.id),
    [tabs, activeProject?.id]
  );

  useEffect(() => {
    closeActiveTabRef.current =
      activeProjectTabs.length <= 1
        ? () => void withAlert("Close window", () => getCurrentWindow().close())
        : () => handleCloseTab(activeTabId);
  }, [activeProjectTabs.length, handleCloseTab, activeTabId]);

  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden antialiased">
      <ProjectsSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onOpenDirPicker={() => void withAlert("Open folder", triggerDirPicker)}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        groups={groups}
        onCreateGroup={handleCreateGroup}
        onUpdateGroup={(id, patch) => void handleUpdateGroup(id, patch)}
        onDeleteGroup={(id) => void handleDeleteGroup(id)}
        onSetProjectGroup={(projectId, groupId) => void handleSetProjectGroup(projectId, groupId)}
        projectStates={projectStates}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 w-full flex-1">
          <section className="border-border/80 flex h-full w-3/5 min-w-0 flex-col border-r">
            <TabBar
              tabs={activeProjectTabs.map((t) => ({
                id: t.id,
                title: t.title,
                showContext: t.showContext,
                loading: t.loading,
                hasUnread: t.hasUnread,
                isPaused: !!t.pauseState,
                needsInput: t.pendingPrompt !== undefined,
              }))}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
              onToggleContext={handleToggleContext}
            />
            {activeTab.loadErrors && activeTab.loadErrors.length > 0 && (
              <TabLoadErrorBanner
                errors={activeTab.loadErrors}
                onCloseTab={() => handleCloseTab(activeTab.id)}
              />
            )}
            {activeTab.kind === "settings" ? (
              <SettingsPanel
                workspacePath={activeProject?.path}
                sessions={activeProjectTabs
                  .filter((t) => t.kind !== "settings")
                  .map((t) => ({ id: t.id, title: t.title }))}
                models={models}
                onSaved={handleSettingsSaved}
              />
            ) : (
              <SessionJobs workspaceDir={activeProject?.path} sessionId={activeTab.id}>
                <ChatPanel
                  sessionId={activeTab.id}
                  messages={activeTab.messages}
                  contextMessages={activeTab.contextMessages}
                  showContext={activeTab.showContext}
                  loading={activeTab.loading}
                  phase={composerPhase(activeTab)}
                  queuedPrompts={activeTab.queuedPrompts}
                  waitingOn={activeTab.waitingOn}
                  pendingPrompt={activeTab.pendingPrompt}
                  onSendMessage={handleSendMessage}
                  onStopMessage={() => void withAlert("Stop", handleStopMessage)}
                  toolControls={{
                    stop: (toolCallId) => didStopToolCallApi(activeTab.id, toolCallId),
                    background: (toolCallId) => didBackgroundToolCallApi(activeTab.id, toolCallId),
                  }}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemoveQueued={handleRemoveQueued}
                  onPopQueued={handlePopQueued}
                  onRetry={() => void withAlert("Retry", handleRetry)}
                  turnTree={activeTab.turnTree}
                  draft={activeTab.draft}
                  onRewind={(turn) => void withAlert("Rewind", () => handleRewind(turn))}
                  onFork={(turn) => void withAlert("Fork", () => handleFork(turn))}
                  onSwitchBranch={(head) =>
                    void withAlert("Switch branch", () => handleSwitchBranch(head))
                  }
                  selectedModel={activeTab.selectedModel || DEFAULT_MODEL_ID}
                  onSelectModel={handleSelectModel}
                  models={models}
                  contextTokens={activeTab.contextTokens}
                  thinkingLevel={activeTab.thinkingLevel || "Low"}
                  onSelectThinkingLevel={handleSelectThinkingLevel}
                  executionMode={activeTab.executionMode || DEFAULT_EXECUTION_MODE}
                  onSelectExecutionMode={handleSelectExecutionMode}
                  onCycleExecutionMode={handleCycleExecutionMode}
                  hasNetworkAccess={activeTab.hasNetworkAccess ?? false}
                  onToggleHasNetworkAccess={handleToggleHasNetworkAccess}
                  governorMode={activeTab.governorMode ?? DEFAULT_GOVERNOR_MODE}
                  onCycleGovernorMode={handleCycleGovernorMode}
                  isTeacherEnabled={activeTab.teacherEnabled ?? true}
                  onToggleTeacher={handleToggleTeacher}
                  onRespondToPrompt={handleRespondToPrompt}
                  collapseWorkerText={activeTab.collapseWorkerText ?? true}
                  openIntents={activeTab.governorState.intent_stack.map((i) => i.description)}
                />
              </SessionJobs>
            )}
          </section>

          <section className="flex h-full w-2/5 min-w-0 flex-col">
            <IntentsPanel
              key={activeTab.id}
              sessionId={activeTab.id}
              workspacePath={activeProject?.path || "."}
              selectedModel={activeTab.selectedModel || DEFAULT_MODEL_ID}
              thinkingLevel={activeTab.thinkingLevel || "Low"}
              executionMode={activeTab.executionMode || DEFAULT_EXECUTION_MODE}
              governorMode={activeTab.governorMode ?? DEFAULT_GOVERNOR_MODE}
              isTeacherEnabled={activeTab.teacherEnabled ?? true}
              models={models}
              interceptorSettings={activeTab.interceptorSettings}
              onSetInterceptorSettings={handleSetInterceptorSettings}
              messages={activeTab.messages}
              profile={activeTab.profile}
              tokenUsage={activeTab.tokenUsage}
              intentStack={activeTab.governorState.intent_stack}
              completedIntents={activeTab.governorState.completed_intents}
              assumptions={activeTab.governorState.assumptions}
              consoleEvents={activeTab.consoleEvents || []}
              agentFiles={activeTab.agentFiles || []}
              onClearConsole={() => handleClearConsole(activeTab.id)}
              enabledTools={activeTab.enabledTools || INITIAL_TOOLS}
              onToggleTool={handleToggleTool}
              onSetAllTools={handleSetAllTools}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
