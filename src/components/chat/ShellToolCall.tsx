import {
  Check,
  Circle,
  CircleSlash,
  GraduationCap,
  Hourglass,
  Loader2,
  Shield,
  X,
} from "lucide-react";
import { EXECUTION_MODE_LEVELS, type ExecutionMode, type ToolCallInfo } from "@/types";
import { TOOL_SPECS } from "@/core/tools/specs";
import { isShellFailure, shellResult } from "./shellStatus";
import { MODE_STYLES } from "./modeStyles";

const SHELL_MODES: Record<string, ExecutionMode> = {
  [TOOL_SPECS.shellProjectReadOnly.name]: "restricted",
  [TOOL_SPECS.shellReadOnly.name]: "read",
  [TOOL_SPECS.shellProjectWrite.name]: "write",
  [TOOL_SPECS.shellFullAccess.name]: "god",
};

function ShellMode({ name, withLevel = false }: { name: string; withLevel?: boolean }) {
  const mode = SHELL_MODES[name];
  if (!mode) return <span className="text-muted-foreground">{withLevel ? name : "sh"}</span>;
  return (
    <span className={MODE_STYLES[mode].label}>
      {withLevel ? `${EXECUTION_MODE_LEVELS[mode]} · ${mode}` : mode}
    </span>
  );
}

export function BlockedIcon({ interceptor }: { interceptor?: string }) {
  const Icon = interceptor === "ToolTeacher" ? GraduationCap : Shield;
  return (
    <span className="text-destructive relative flex size-3.5" title={`Blocked by ${interceptor}`}>
      <Icon className="size-3.5" />
      <span className="ring-background absolute top-1/2 left-1/2 h-0.5 w-4.5 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current ring-1" />
    </span>
  );
}

function ShellModeDot({ name }: { name: string }) {
  const mode = SHELL_MODES[name];
  return (
    <span
      className={`mr-1.5 inline-flex h-3 shrink-0 items-center ${mode ? MODE_STYLES[mode].label : "text-muted-foreground"}`}
      title={mode ?? name}
    >
      <Circle className="size-1.5 fill-current" />
    </span>
  );
}

export function ShellStatus({ tc }: { tc: ToolCallInfo }) {
  const parsed = shellResult(tc);
  switch (tc.status) {
    case "pending": {
      return <Hourglass className="size-3.5 text-amber-500" />;
    }
    case "rejected": {
      return <CircleSlash className="text-muted-foreground size-3.5" />;
    }
    case "blocked": {
      return <BlockedIcon interceptor={tc.blockedBy} />;
    }
    case "executed": {
      return isShellFailure(parsed) ? (
        <X className="text-destructive size-3.5" />
      ) : (
        <Check className="size-3.5 text-emerald-500" />
      );
    }
    default: {
      return <Loader2 className="text-muted-foreground size-3.5 animate-spin" />;
    }
  }
}

export function ShellSummary({ tc }: { tc: ToolCallInfo }) {
  const tcArguments = tc.args ?? {};
  const command = String(tcArguments.command || tcArguments.cmd || "");
  const query = typeof tcArguments.query === "string" ? tcArguments.query : "";
  const blocked = tc.status === "blocked" ? "line-through opacity-60" : "";
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span
        className={`text-foreground font-mono leading-4 font-semibold break-all whitespace-pre-wrap ${blocked}`}
      >
        {command}
      </span>
      {query && (
        <span className="text-muted-foreground text-2xs font-mono leading-3 break-all whitespace-pre-wrap">
          <span className="font-semibold tracking-wider uppercase">Query</span> {query}
        </span>
      )}
      <span className="flex items-center">
        <ShellModeDot name={tc.name} />
        <ShellMeta tc={tc} />
      </span>
    </span>
  );
}

const EXIT_LABELS = {
  killed: "killed",
  stopped: "stopped",
  timeout: "timed out",
  background: "moved to background",
} as const;

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ShellMeta({ tc }: { tc: ToolCallInfo }) {
  const meta = "text-muted-foreground/70 text-2xs font-mono leading-3";
  if (tc.status === "running" || tc.status === undefined)
    return <span className={meta}>running…</span>;
  const parsed = shellResult(tc);
  if (tc.status !== "executed" || parsed?.exitCode === undefined) return null;
  const isFailed = parsed.exitCode !== 0;
  return (
    <span className={meta}>
      <span className={isFailed ? "text-destructive" : ""}>
        {typeof parsed.exitCode === "number"
          ? `exit ${parsed.exitCode}`
          : EXIT_LABELS[parsed.exitCode]}
      </span>
      {parsed.durationMs !== undefined && ` · ${formatDuration(parsed.durationMs)}`}
    </span>
  );
}

export function ShellDetails({ tc }: { tc: ToolCallInfo }) {
  const parsed = shellResult(tc);
  return (
    <>
      <div className="text-muted-foreground text-2xs flex gap-4">
        <span>
          <span className="font-semibold tracking-wider uppercase">Mode</span>{" "}
          <ShellMode name={tc.name} withLevel />
        </span>
      </div>
      {parsed && (
        <div>
          <div className="text-muted-foreground text-2xs font-semibold tracking-wider uppercase">
            Output
          </div>
          <pre className="border-border/40 bg-background/60 text-foreground/80 text-2xs mt-0.5 max-h-48 overflow-x-auto rounded-xs border p-1.5 whitespace-pre-wrap">
            {parsed.output}
          </pre>
        </div>
      )}
    </>
  );
}
