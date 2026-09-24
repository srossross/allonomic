import { useState, useEffect, useRef } from "react";
import { ProjectsSidebar } from "@/components/sidebar/ProjectsSidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConstraintsAndIntentsPanel } from "@/components/inspector/ConstraintsAndIntentsPanel";
import { useTabsManager } from "@/hooks/useTabsManager";
import { useToolApprovals } from "@/hooks/useToolApprovals";
import { useProjectManager } from "@/hooks/useProjectManager";
import type { InjectorMeta } from "@/types";

export function App() {
  const [injectors, setInjectors] = useState<InjectorMeta[]>([]);

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
      />

      {/* RIGHT MAIN AREA: Tabs across top, then 60/40 panels */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.title,
            projectId: t.projectId,
            showContext: t.showContext,
          }))}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          onToggleContext={handleToggleContext}
        />

        {/* Workspace: 60% Chat / 40% Constraints & Intents (scoped to active tab) */}
        <main className="flex min-h-0 w-full flex-1">
          <section className="flex h-full w-[60%] min-w-0 flex-col">
            <ChatPanel
              messages={activeTab.messages}
              contextMessages={activeTab.contextMessages}
              showContext={activeTab.showContext}
              onToggleContext={() => handleToggleContext(activeTab.id)}
              loading={activeTab.loading}
              onSendMessage={handleSendMessage}
              onStopMessage={handleStopMessage}
              selectedModel={activeTab.selectedModel || "gemini-2.5-flash"}
              onSelectModel={handleSelectModel}
              thinkingLevel={activeTab.thinkingLevel || "High"}
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
