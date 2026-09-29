import { useState, useEffect, useRef, useMemo } from "react";
import { ProjectsSidebar } from "@/components/sidebar/ProjectsSidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { TabLoadErrorBanner } from "@/components/tabs/TabLoadErrorBanner";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { IntentsPanel } from "@/components/inspector/IntentsPanel";
import { useTabsManager } from "@/hooks/useTabsManager";
import { usePromptResponses } from "@/hooks/usePromptResponses";
import { useProjectManager } from "@/hooks/useProjectManager";
import { fetchModelsApi } from "@/agent/api";
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
    handleAddProject,
    handleRenameProject,
    handleDeleteProject,
    globalDirPickerRef,
  } = useProjectManager(() => newTabRef.current());

  useEffect(() => {
    let isCancelled = false;
    async function loadModels() {
      try {
        const loaded = await fetchModelsApi(activeProject?.path);
        if (!isCancelled) setModels(loaded);
      } catch (error) {
        console.error("[Models] Failed to load models:", error);
        globalThis.alert(
          "Failed to load models: " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
    void loadModels();
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
    handleClearConsole,
    handleToggleContext,
    handleToggleTool,
    handleSetAllTools,
  } = useTabsManager(activeProject);

  const { handleRespondToPrompt } = usePromptResponses({ activeProject, activeTab });

  useEffect(() => {
    newTabRef.current = handleNewTab;
  }, [handleNewTab]);

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

  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden antialiased">
      {/* Hidden directory input for fallback */}
      <input
        ref={globalDirPickerRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard for directory picker
        webkitdirectory="true"
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            const firstFile = files[0];
            const relativePath = firstFile.webkitRelativePath || "";
            const dirName = relativePath.split("/", 1)[0] || firstFile.name || "New Project";
            handleAddProject(dirName, dirName);
          }
          e.target.value = "";
        }}
      />

      {/* LEFT PANEL: Projects sidebar */}
      <ProjectsSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onAddProject={handleAddProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        projectStates={projectStates}
      />

      {/* RIGHT MAIN AREA: Tabs across top, then 60/40 panels */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Workspace: 60% Chat / 40% Intents (scoped to active tab) */}
        <main className="flex min-h-0 w-full flex-1">
          <section className="border-border/80 flex h-full w-3/5 min-w-0 flex-col border-r">
            <TabBar
              tabs={activeProjectTabs.map((t) => ({
                id: t.id,
                title: t.title,
                projectId: t.projectId,
                showContext: t.showContext,
                loading: t.loading,
                hasUnread: t.hasUnread,
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
            <ChatPanel
              messages={activeTab.messages}
              contextMessages={activeTab.contextMessages}
              showContext={activeTab.showContext}
              onToggleContext={() => handleToggleContext(activeTab.id)}
              loading={activeTab.loading}
              waitingOn={activeTab.waitingOn}
              onSendMessage={handleSendMessage}
              onStopMessage={handleStopMessage}
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
            />
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
              intentStack={activeTab.governorState.intent_stack}
              completedIntents={activeTab.governorState.completed_intents}
              falseCompletions={activeTab.governorState.false_completions}
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
