import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import type { UserIntent } from "@/core/governor/types";
import { usageCost, type TokenUsage } from "@/core/turn/usage";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL_ID,
  type Message,
  type ModelOption,
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
  tokenUsage?: TokenUsage;
  models?: ModelOption[];
}

export function SessionTab({
  sessionId = "default-session",
  workspacePath = ".",
  selectedModel = DEFAULT_MODEL_ID,
  thinkingLevel = "Low",
  executionMode = DEFAULT_EXECUTION_MODE,
  intentStack = [],
  messages = [],
  tokenUsage = [],
  models = [],
}: SessionTabProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const normalizedWorkspace = workspacePath.replace(/\/+$/, "");
  const sessionDir = `${normalizedWorkspace}/.allonomic/sessions/${sessionId}`;

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
    <div className="divide-border/30 divide-y text-xs">
      <button
        type="button"
        onClick={handleCopyShareableTrace}
        className="hover:bg-muted/50 flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left transition-colors"
      >
        {copiedKey === "trace" ? (
          <Check className="size-3 text-green-500" />
        ) : (
          <Copy className="text-muted-foreground size-3" />
        )}
        <span className="text-foreground font-medium">
          {copiedKey === "trace" ? "Copied" : "Copy session"}
        </span>
      </button>
      <CopyRow
        label="Session dir"
        value={sessionDir}
        display={tildify(sessionDir)}
        isCopied={copiedKey === "sessionDir"}
        onCopy={() => copyToClipboard(sessionDir, "sessionDir")}
      />
      <UsageTable tokenUsage={tokenUsage} models={models} />
    </div>
  );
}

function formatCost(cost: number | undefined): string {
  return cost === undefined ? "—" : `$${cost.toFixed(2)}`;
}

function UsageRow({ label, input, output }: { label: string; input: string; output: string }) {
  return (
    <div className="text-foreground flex gap-3 py-0.5 font-mono font-medium tabular-nums">
      <span className="flex-1">{label}</span>
      <span className="w-20 text-right">{input}</span>
      <span className="w-20 text-right">{output}</span>
    </div>
  );
}

function UsageTable({ tokenUsage, models }: { tokenUsage: TokenUsage; models: ModelOption[] }) {
  const rows = tokenUsage.map((row) => {
    const price = models.find((m) => m.id === row.model)?.price;
    return { row, cost: price && usageCost(row, price) };
  });
  const isFullyPriced = rows.every(({ cost }) => cost);
  const totalCost = isFullyPriced
    ? {
        input: rows.reduce((sum, { cost }) => sum + (cost?.input ?? 0), 0),
        output: rows.reduce((sum, { cost }) => sum + (cost?.output ?? 0), 0),
      }
    : undefined;

  return (
    <div className="px-2 py-1.5">
      <div className="text-muted-foreground text-2xs flex gap-3">
        <span className="flex-1">Agent</span>
        <span className="w-20 text-right">In</span>
        <span className="w-20 text-right">Out</span>
      </div>
      {rows.map(({ row }) => (
        <div key={`${row.agent}:${row.model}`} className="flex gap-3 py-0.5 font-mono tabular-nums">
          <div className="min-w-0 flex-1">
            <div className="text-foreground break-all">{row.agent}</div>
            <div className="text-muted-foreground text-2xs truncate">{row.model}</div>
          </div>
          <span className="w-20 text-right">{row.inputTokens.toLocaleString()}</span>
          <span className="w-20 text-right">{row.outputTokens.toLocaleString()}</span>
        </div>
      ))}
      <div className="border-border/30 mt-1 border-t pt-1">
        <UsageRow
          label="Total tokens"
          input={tokenUsage.reduce((sum, row) => sum + row.inputTokens, 0).toLocaleString()}
          output={tokenUsage.reduce((sum, row) => sum + row.outputTokens, 0).toLocaleString()}
        />
        <UsageRow
          label="Total cost"
          input={formatCost(totalCost?.input)}
          output={formatCost(totalCost?.output)}
        />
      </div>
      <div className="text-foreground mt-1 flex justify-between font-mono font-medium tabular-nums">
        <span>Total cost</span>
        <span>{formatCost(totalCost && totalCost.input + totalCost.output)}</span>
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
    <div className="px-2 py-1.5">
      <div className="text-muted-foreground flex items-center justify-between text-2xs">
        <span>{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="hover:text-foreground flex cursor-pointer items-center gap-1 transition-colors"
        >
          {isCopied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
        </button>
      </div>
      <div className="text-foreground mt-0.5 font-mono text-xs break-all select-all">{display}</div>
    </div>
  );
}
