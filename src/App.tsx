import { useState, useEffect, useRef, useMemo } from "react";
import { ProjectsSidebar } from "@/components/sidebar/ProjectsSidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConstraintsAndIntentsPanel } from "@/components/inspector/ConstraintsAndIntentsPanel";
import { useTabsManager } from "@/hooks/useTabsManager";
import { useToolApprovals } from "@/hooks/useToolApprovals";
import { useProjectManager } from "@/hooks/useProjectManager";
import { fetchModelsApi } from "@/agent/api";
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, type InjectorMeta, type ModelOption } from "@/types";

export function App() {
  const [injectors, setInjectors] = useState<InjectorMeta[]>([]);
  const [models, setModels] = useState<ModelOption[]>(AVAILABLE_MODELS);

  useEffect(() => {
    async function loadModels() {
      try {
        const dynamicModels = await fetchModelsApi();
        if (dynamicModels && dynamicModels.length > 0) {
          setModels(dynamicModels);
        }
      } catch {
        // Fallback already handled
      }
    }
    void loadModels();
  }, []);

  useEffect(() => {
    async function loadInjectors() {
      try {
        const res = await fetch("/api/agent/injectors");
        if (res.ok) {
          const data: unknown = await res.json();
          if (
            data &&
            typeof data === "object" &&
            "injectors" in data &&
            Array.isArray(data.injectors)
          ) {
            setInjectors(data.injectors);
          }
        }
      } catch {
        // Fallback to default injectors if offline/unavailable
      }
    }
    void loadInjectors();
  }, []);

  const newTabRef = useRef<() => void>(() => {});

  const {
    projects,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    handleAddProject,
    globalDirPickerRef,
  } = useProjectManager(() => newTabRef.current());

  const {
    tabs,
    setTabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    handleNewTab,
    handleCloseTab,
    handleSelectModel,
    handleSelectThinkingLevel,
    handleSelectExecutionMode,
    handleCycleExecutionMode,
    handleSendMessage,
    handleStopMessage,
    handleClearConsole,
    handleToggleContext,
    handleToggleTool,
    handleSetAllTools,
  } = useTabsManager(activeProject);

  const { handleApproveTool, handleRejectTool } = useToolApprovals({
    activeProject,
    activeTabId,
    setTabs,
  });

  useEffect(() => {
    newTabRef.current = handleNewTab;
  }, [handleNewTab]);

  const projectStates = useMemo(() => {
    const states: Record<string, { agentState: 'idle' | 'running' | 'awaiting', hasUnread: boolean }> = {};
    for (const proj of projects) {
      const projTabs = tabs.filter(t => t.projectId === proj.id);
      const isRunning = projTabs.some(t => t.loading);
      const hasUnread = projTabs.some(t => t.hasUnread);
      states[proj.id] = {
        agentState: isRunning ? 'running' : (hasUnread ? 'awaiting' : 'idle'),
        hasUnread
      };
    }
    return states;
  }, [projects, tabs]);

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
        projectStates={projectStates}
      />

      {/* RIGHT MAIN AREA: Tabs across top, then 60/40 panels */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Workspace: 60% Chat / 40% Constraints & Intents (scoped to active tab) */}
        <main className="flex min-h-0 w-full flex-1">
          <section className="border-border/80 flex h-full w-[60%] min-w-0 flex-col border-r">
            <TabBar
              tabs={tabs.map((t) => ({
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
            <ChatPanel
              messages={activeTab.messages}
              contextMessages={activeTab.contextMessages}
              showContext={activeTab.showContext}
              onToggleContext={() => handleToggleContext(activeTab.id)}
              loading={activeTab.loading}
              onSendMessage={handleSendMessage}
              onStopMessage={handleStopMessage}
              selectedModel={activeTab.selectedModel || DEFAULT_MODEL_ID}
              onSelectModel={handleSelectModel}
              models={models}
              thinkingLevel={activeTab.thinkingLevel || "Low"}
              onSelectThinkingLevel={handleSelectThinkingLevel}
              executionMode={activeTab.executionMode || "manual"}
              onSelectExecutionMode={handleSelectExecutionMode}
              onCycleExecutionMode={handleCycleExecutionMode}
              onApproveTool={handleApproveTool}
              onRejectTool={handleRejectTool}
            />
          </section>

          <section className="flex h-full w-[40%] min-w-0 flex-col">
            <ConstraintsAndIntentsPanel
              key={activeTab.id}
              sessionId={activeTab.id}
              workspacePath={activeProject?.path || "."}
              selectedModel={activeTab.selectedModel || DEFAULT_MODEL_ID}
              thinkingLevel={activeTab.thinkingLevel || "Low"}
              executionMode={activeTab.executionMode || "manual"}
              messages={activeTab.messages}
              intentStack={activeTab.governorState.intent_stack}
              completedIntents={activeTab.governorState.completed_intents}
              globalConstraints={activeTab.governorState.global_constraints}
              consoleEvents={activeTab.consoleEvents || []}
              onClearConsole={() => handleClearConsole(activeTab.id)}
              enabledTools={
                activeTab.enabledTools || ["read_file", "write_file", "list_files", "run_command"]
              }
              onToggleTool={handleToggleTool}
              onSetAllTools={handleSetAllTools}
              injectors={injectors.length > 0 ? injectors : undefined}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
