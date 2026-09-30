import { useEffect, useRef, useState } from "react";
import { Copy, Check, Folder, FileText, Share2, Cpu, Sparkles } from "lucide-react";
import type { UserIntent } from "@/core/governor/types";
import { GRAPH_RECURSION_LIMIT } from "@/core/graph/limits";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL_ID,
  type Message,
  type ThinkingLevel,
  type ExecutionMode,
} from "@/types";
import { alertError } from "@/lib/alertError";
import { tildify } from "@/lib/tildify";

export interface SessionTabProps {
  sessionId?: string;
  workspacePath?: string;
  selectedModel?: string;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
  intentStack?: UserIntent[];
  messages?: Message[];
}

export function SessionTab({
  sessionId = "default-session",
  workspacePath = ".",
  selectedModel = DEFAULT_MODEL_ID,
  thinkingLevel = "Low",
  executionMode = DEFAULT_EXECUTION_MODE,
  intentStack = [],
  messages = [],
}: SessionTabProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const normalizedWorkspace = workspacePath.replace(/\/+$/, "");
  const sessionDir = `${normalizedWorkspace}/.allonomic/sessions/${sessionId}`;
  const turnsDir = `${sessionDir}/turns`;

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      alertError("Copy to clipboard")(error);
    }
  };

  const handleCopyShareableTrace = async () => {
    const trace = [
      `### Allonomic Session Share: \`${sessionId}\``,
      `- **Workspace**: \`${workspacePath}\``,
      `- **Session Path**: \`${sessionDir}\``,
      `- **Model**: \`${selectedModel}\``,
      `- **Thinking Level**: \`${thinkingLevel}\``,
      `- **Execution Mode**: \`${executionMode}\``,
      "",
      "#### Active Intents:",
      intentStack.length === 0
        ? "_None_"
        : intentStack.map((i) => `* [${i.kind}] \`${i.id}\`: ${i.description}`).join("\n"),
      "",
      "#### Message Trace:",
      messages
        .map((m, index) => {
          const content =
            typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2);
          const toolCalls =
            m.toolCalls && m.toolCalls.length > 0
              ? `\n  - Tool Calls: ${m.toolCalls.map((t) => t.name).join(", ")}`
              : "";
          return `**[${index + 1}] ${m.role.toUpperCase()}:**\n${content}${toolCalls}`;
        })
        .join("\n\n"),
    ].join("\n");

    await copyToClipboard(trace, "trace");
  };

  return (
    <div className="space-y-4 p-2 text-xs">
      <div className="bg-card border-border/80 rounded-md border p-3 shadow-xs">
        <div className="text-foreground flex items-center justify-between pb-2 font-medium">
          <div className="flex items-center gap-1.5">
            <Folder className="text-primary size-4" />
            <span>Session Storage</span>
          </div>
          <button
            type="button"
            onClick={handleCopyShareableTrace}
            className="bg-primary/10 hover:bg-primary/20 text-primary flex cursor-pointer items-center gap-1 rounded-xs px-2 py-0.5 text-xs font-medium transition-colors"
            title="Format and copy the active session state to share in chat"
          >
            {copiedKey === "trace" ? (
              <>
                <Check className="size-3 text-green-500" />
                <span>Copied Trace!</span>
              </>
            ) : (
              <>
                <Share2 className="size-3" />
                <span>Share Session</span>
              </>
            )}
          </button>
        </div>

        <p className="text-muted-foreground pb-3 text-xs">
          Session checkpoints, turns, and telemetry are persisted inside your workspace&apos;s{" "}
          <code className="bg-muted text-foreground text-2xs rounded-xs px-1 py-0.5 font-mono">
            .allonomic/
          </code>{" "}
          folder.
        </p>

        <div className="space-y-2">
          <CopyRow
            label="Active Session ID"
            value={sessionId}
            isCopied={copiedKey === "sessionId"}
            onCopy={() => copyToClipboard(sessionId, "sessionId")}
          />
          <CopyRow
            label="Session Directory"
            value={sessionDir}
            display={tildify(sessionDir)}
            isCopied={copiedKey === "sessionDir"}
            onCopy={() => copyToClipboard(sessionDir, "sessionDir")}
          />
          <CopyRow
            label="Turns Directory"
            value={turnsDir}
            display={tildify(turnsDir)}
            isCopied={copiedKey === "turnsDir"}
            onCopy={() => copyToClipboard(turnsDir, "turnsDir")}
          />
        </div>
      </div>

      <div className="bg-card border-border/80 rounded-md border p-3 shadow-xs">
        <div className="text-foreground flex items-center gap-1.5 pb-2 font-medium">
          <Cpu className="text-primary size-4" />
          <span>Runtime Configuration</span>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Model</span>
            <span className="text-foreground font-mono font-medium">{selectedModel}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="size-3" />
              Thinking Budget
            </span>
            <span className="text-foreground font-medium">{thinkingLevel}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Execution Mode</span>
            <span className="text-foreground font-medium">{executionMode}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted-foreground">Graph Recursion Limit</span>
            <span className="text-foreground font-mono font-medium">
              {GRAPH_RECURSION_LIMIT} steps
            </span>
          </div>
        </div>
      </div>

      <div className="bg-muted/20 border-border/60 rounded-md border p-3">
        <div className="text-foreground flex items-center gap-1.5 font-medium">
          <FileText className="text-muted-foreground size-3.5" />
          <span>How to share this session</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          Click <strong>Share Session</strong> above to copy the formatted session trace to your
          clipboard. You can paste it directly into this chat to inspect prompts, intents, and tool
          calls.
        </p>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  display = value,
  isCopied,
  onCopy,
}: {
  label: string;
  value: string;
  display?: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="bg-muted/40 rounded-xs p-2">
      <div className="text-muted-foreground text-2xs flex items-center justify-between uppercase">
        <span>{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="hover:text-foreground flex cursor-pointer items-center gap-1 transition-colors"
        >
          {isCopied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
          <span>{isCopied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="text-foreground mt-0.5 font-mono text-xs break-all select-all">{display}</div>
    </div>
  );
}
