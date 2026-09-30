import { useState, useEffect, useRef } from "react";
import type { UserIntent, FalseCompletion } from "@/core/governor/types";
import { reframeSatisfaction } from "@/lib/reframeSatisfaction";
import type { InterceptorSettings } from "@/core/config/settings";
import {
  AVAILABLE_TOOLS,
  INITIAL_TOOLS,
  type AgentFileRow,
  type ConsoleEvent,
  type Message,
  type ThinkingLevel,
  type ExecutionMode,
  type GovernorMode,
  type ModelOption,
} from "@/types";
import { IntentsTab } from "./IntentsTab";
import { IntentDetailView } from "./IntentDetailView";
import { ToolsTab } from "./ToolsTab";
import { InjectorsTab } from "./InjectorsTab";
import { ProfileTab } from "./ProfileTab";
import { EMPTY_PROFILE, type Profile } from "@/core/turn/profile";
import { AgentFilesTab } from "./AgentFilesTab";
import { ConsoleTab } from "./ConsoleTab";
import { SessionTab } from "./SessionTab";
import { InspectorTabBar } from "./InspectorTabBar";
import { useInspectorTabs } from "./useInspectorTabs";
import { useInterceptors } from "./useInterceptors";
import { toggleInSet } from "@/lib/toggleInSet";

const EMPTY_INTERCEPTOR_SETTINGS: Record<string, InterceptorSettings> = {};

export interface IntentsPanelProps {
  intentStack?: UserIntent[];
  completedIntents?: UserIntent[];
  falseCompletions?: FalseCompletion[];
  consoleEvents?: ConsoleEvent[];
  agentFiles?: AgentFileRow[];
  onClearConsole?: () => void;
  enabledTools?: string[];
  onToggleTool: (toolName: string) => void;
  onSetAllTools: (isEnabled: boolean) => void;
  sessionId?: string;
  workspacePath?: string;
  selectedModel?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
  governorMode?: GovernorMode;
  isTeacherEnabled?: boolean;
  models?: ModelOption[];
  interceptorSettings?: Record<string, InterceptorSettings>;
  onSetInterceptorSettings?: (name: string, settings: InterceptorSettings) => void;
  messages?: Message[];
  profile?: Profile;
}

export function IntentsPanel({
  intentStack = [],
  completedIntents = [],
  falseCompletions = [],
  consoleEvents = [],
  agentFiles = [],
  onClearConsole,
  enabledTools = INITIAL_TOOLS,
  onToggleTool,
  onSetAllTools,
  sessionId,
  workspacePath,
  selectedModel,
  thinkingLevel,
  executionMode,
  governorMode,
  isTeacherEnabled,
  models = [],
  interceptorSettings = EMPTY_INTERCEPTOR_SETTINGS,
  onSetInterceptorSettings,
  messages,
  profile = EMPTY_PROFILE,
}: IntentsPanelProps) {
  const isGovernorOff = governorMode === "off";
  const { interceptors, error: interceptorsError } = useInterceptors(
    workspacePath,
    sessionId,
    JSON.stringify([governorMode, isTeacherEnabled, selectedModel, interceptorSettings])
  );
  const { order: tabOrder, activeTab, select: selectTab } = useInspectorTabs(workspacePath);
  const [reframedMap, setReframedMap] = useState<Record<string, string>>({});
  const [reframeErrors, setReframeErrors] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{
    intentId: string;
    falseCompletionId: string | null;
  } | null>(null);
  const selectedIntent =
    selection &&
    (intentStack.find((i) => i.id === selection.intentId) ??
      completedIntents.find((i) => i.id === selection.intentId));
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [expandedToolNames, setExpandedToolNames] = useState<Set<string>>(new Set());
  const [expandedInjectorIds, setExpandedInjectorIds] = useState<Set<string>>(new Set());
  const inFlightReference = useRef<Set<string>>(new Set());

  const toggleToolExpanded = (name: string) => {
    setExpandedToolNames((previous) => toggleInSet(previous, name));
  };

  const toggleInjectorExpanded = (id: string) => {
    setExpandedInjectorIds((previous) => toggleInSet(previous, id));
  };

  const toggleEventExpanded = (id: string) => {
    setExpandedEventIds((previous) => toggleInSet(previous, id));
  };

  useEffect(() => {
    const allIntents = [...intentStack, ...completedIntents];

    async function fetchReframe(key: string, description: string) {
      try {
        const condition = await reframeSatisfaction(description);
        setReframedMap((previous) => ({ ...previous, [key]: condition }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setReframeErrors((previous) => ({ ...previous, [key]: message }));
      } finally {
        inFlightReference.current.delete(key);
      }
    }

    for (const intent of allIntents) {
      const key = intent.id || intent.description;
      if (
        !key ||
        Object.hasOwn(reframedMap, key) ||
        Object.hasOwn(reframeErrors, key) ||
        inFlightReference.current.has(key)
      )
        continue;

      inFlightReference.current.add(key);
      void fetchReframe(key, intent.description);
    }
  }, [intentStack, completedIntents, reframedMap, reframeErrors]);

  return (
    <div className="bg-background flex h-full flex-col select-none">
      <InspectorTabBar
        order={tabOrder}
        activeTab={activeTab}
        onSelect={selectTab}
        labels={{
          intent: {
            label: "Intent",
            badge: intentStack.length > 0 && (
              <span className="text-primary text-2xs ml-1 font-semibold">{intentStack.length}</span>
            ),
          },
          console: {
            label: "console",
            badge: consoleEvents.length > 0 && (
              <span className="text-muted-foreground text-2xs ml-1 font-mono">
                {consoleEvents.length}
              </span>
            ),
          },
          profile: { label: "profile" },
          tools: {
            label: "tools",
            badge: (
              <span className="text-muted-foreground text-2xs ml-1 font-mono">
                {enabledTools.length}/{AVAILABLE_TOOLS.length}
              </span>
            ),
          },
          injectors: {
            label: "injectors",
            badge: (
              <span className="text-muted-foreground text-2xs ml-1 font-mono">
                {interceptors.length}
              </span>
            ),
          },
          files: {
            label: "files",
            badge: agentFiles.length > 0 && (
              <span
                className={`text-2xs ml-1 font-mono ${agentFiles.some((file) => file.missing) ? "text-destructive" : "text-muted-foreground"}`}
              >
                {agentFiles.length}
              </span>
            ),
          },
          session: { label: "session" },
        }}
        trailing={
          activeTab === "console" &&
          consoleEvents.length > 0 &&
          onClearConsole && (
            <button
              type="button"
              onClick={onClearConsole}
              className="text-muted-foreground hover:bg-muted/40 hover:text-foreground text-2xs cursor-pointer rounded-xs px-1.5 py-0.5 font-mono transition-colors"
              title="Clear Console"
            >
              clear
            </button>
          )
        }
      />

      {/* Flat List Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "intent" &&
          (isGovernorOff ? (
            <div className="text-muted-foreground p-3 text-xs">Governor disabled.</div>
          ) : selectedIntent ? (
            <IntentDetailView
              intent={selectedIntent}
              isDone={!intentStack.includes(selectedIntent)}
              falseCompletions={falseCompletions.filter((r) => r.intent_id === selectedIntent.id)}
              reframed={reframedMap[selectedIntent.id]}
              reframeError={reframeErrors[selectedIntent.id]}
              focusFalseCompletionId={selection?.falseCompletionId ?? null}
              onBack={() => setSelection(null)}
            />
          ) : (
            <IntentsTab
              intentStack={intentStack}
              completedIntents={completedIntents}
              falseCompletions={falseCompletions}
              onSelect={(intentId, falseCompletionId) =>
                setSelection({ intentId, falseCompletionId: falseCompletionId ?? null })
              }
            />
          ))}

        {activeTab === "console" && (
          <ConsoleTab
            consoleEvents={consoleEvents}
            expandedEventIds={expandedEventIds}
            onToggleExpand={toggleEventExpanded}
          />
        )}

        {activeTab === "profile" && <ProfileTab profile={profile} />}

        {activeTab === "tools" && (
          <ToolsTab
            activeEnabledTools={enabledTools}
            expandedToolNames={expandedToolNames}
            onToggleTool={onToggleTool}
            onSetAllTools={onSetAllTools}
            onToggleExpand={toggleToolExpanded}
          />
        )}

        {activeTab === "injectors" && (
          <InjectorsTab
            interceptors={interceptors}
            error={interceptorsError}
            expandedNames={expandedInjectorIds}
            onToggleExpand={toggleInjectorExpanded}
            models={models}
            settings={interceptorSettings}
            onSetSettings={onSetInterceptorSettings}
          />
        )}

        {activeTab === "files" && (
          <AgentFilesTab agentFiles={agentFiles} workspacePath={workspacePath} />
        )}

        {activeTab === "session" && (
          <SessionTab
            sessionId={sessionId}
            workspacePath={workspacePath}
            selectedModel={selectedModel}
            thinkingLevel={thinkingLevel}
            executionMode={executionMode}
            intentStack={intentStack}
            messages={messages}
          />
        )}
      </div>
    </div>
  );
}
