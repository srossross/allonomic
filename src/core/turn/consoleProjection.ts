import type { ConsoleBadgeVariant, ConsoleEvent } from "../../types";
import type { GovernorAction } from "../governor/types";
import type { TurnEvent } from "./events";

export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface Row {
  type: string;
  badge: string;
  badgeVariant: ConsoleBadgeVariant;
  summary: string;
  details?: unknown;
}

const SETTINGS_ROW = { type: "user_prompt", badge: "SETTINGS", badgeVariant: "sky" } as const;

function actionSummary(action: GovernorAction): string {
  switch (action.type) {
    case "push_intent": {
      return `push_intent: (${action.intent.kind}) "${action.intent.description}"`;
    }
    case "update_intent": {
      return `update_intent: '${action.id}'${action.kind ? ` (${action.kind})` : ""}${action.description ? ` "${action.description}"` : ""}`;
    }
    case "record_assumption": {
      return `record_assumption: [${action.assumption.status}] "${action.assumption.text}" → '${action.assumption.intent_id}'`;
    }
    case "classify_assumption":
    case "drop_assumption": {
      return `${action.type}: '${action.id}'`;
    }
    case "clear_assumptions": {
      return "clear_assumptions";
    }
    case "resolve_assumption": {
      return `resolve_assumption: '${action.id}' — ${action.evidence}`;
    }
    case "pop_intent": {
      return `pop_intent: ${action.id ?? "top"}`;
    }
    case "resolve_intent": {
      return `resolve_intent: satisfied '${action.id}'`;
    }
    case "begin_prompt": {
      return "begin_prompt";
    }
  }
}

function lineCount(text: string): number {
  return text.trim().split("\n").length;
}

function gov(name: string): string {
  return `GOV:${name}`;
}

function rows(event: TurnEvent): Row[] {
  switch (event.type) {
    case "turn_started": {
      const summary = event.prompt ?? "(Resumed)";
      return [
        {
          type: "user_prompt",
          badge: "USER",
          badgeVariant: "sky",
          summary,
          details: { prompt: event.prompt, threadId: event.threadId },
        },
      ];
    }
    case "governor_action": {
      return [
        {
          type: `governor_${event.phase}`,
          badge: gov(event.interceptor),
          badgeVariant: "purple",
          summary: actionSummary(event.action),
          details: event.action,
        },
      ];
    }
    case "governor_verdict": {
      const summary =
        event.phase === "entry"
          ? event.approved
            ? `finish${event.reasoning ? `: ${event.reasoning}` : ""}`
            : `finish rejected: ${event.feedback ?? ""}`
          : `finish: approved: ${event.approved}${event.feedback ? ` (feedback: "${event.feedback}")` : ""}`;
      return [
        {
          type: `governor_${event.phase}`,
          badge: gov(event.interceptor),
          badgeVariant: event.approved ? "purple" : "destructive",
          summary,
          details: event,
        },
      ];
    }
    case "governor_brief": {
      return [
        {
          type: "governor_entry",
          badge: gov(event.interceptor),
          badgeVariant: "purple",
          summary: `brief: ${event.doneWhen.join("; ") || event.text.slice(0, 120)}`,
          details: event,
        },
      ];
    }
    case "governor_fork": {
      return event.messages.flatMap((message): Row[] =>
        message.role === "ai" && message.thinking
          ? [
              {
                type: "governor_thought",
                badge: gov(event.interceptor),
                badgeVariant: "purple",
                summary: `${event.pass} thinking (${lineCount(message.thinking)} lines): ${message.thinking.slice(0, 80).replaceAll("\n", " ")}...`,
                details: {
                  pass: event.pass,
                  thinking: message.thinking,
                  toolCalls: message.toolCalls,
                },
              },
            ]
          : []
      );
    }
    case "governor_tool_decision": {
      return [
        {
          type: "governor_pre_tool",
          badge: gov(event.interceptor),
          badgeVariant: event.approved ? "purple" : "destructive",
          summary: event.approved
            ? `Approved ${event.tool}`
            : `Blocked ${event.tool}: ${event.reason ?? "Disallowed"}`,
          details: event,
        },
      ];
    }
    case "model_step": {
      const out: Row[] = [];
      if (event.thinking) {
        out.push({
          type: "worker_thought",
          badge: "AGENT",
          badgeVariant: "purple",
          summary: `Thinking (${lineCount(event.thinking)} lines): ${event.thinking.slice(0, 80).replaceAll("\n", " ")}...`,
          details: { thinking: event.thinking },
        });
      }
      for (const call of event.toolCalls) {
        out.push({
          type: "worker_tool_call",
          badge: "AGENT",
          badgeVariant: "amber",
          summary: `${call.name}(${JSON.stringify(call.args)})`,
          details: call,
        });
      }
      if (event.toolCalls.length === 0 && event.content) {
        out.push({
          type: "worker_response",
          badge: "AGENT",
          badgeVariant: "emerald",
          summary: event.content.slice(0, 120),
          details: { content: event.content },
        });
      }
      return out;
    }
    case "tool_result": {
      return [
        {
          type: "tool_result",
          badge: "TOOL",
          badgeVariant: "neutral",
          summary: `Result of ${event.name}: ${event.content.slice(0, 100)}`,
          details: event,
        },
      ];
    }
    case "prompt_requested": {
      return [
        {
          type: "action",
          badge: "ASK",
          badgeVariant: "amber",
          summary: `Waiting for user: ${event.prompt.label}`,
          details: event,
        },
      ];
    }
    case "prompt_answered": {
      const isRejected = event.value === false;
      return [
        {
          type: isRejected ? "warning" : "action",
          badge: isRejected ? "REJECTED" : "ANSWERED",
          badgeVariant: isRejected ? "destructive" : "emerald",
          summary: `User answered: ${String(event.value)}`,
          details: event,
        },
      ];
    }
    case "context_files_loaded": {
      return event.files
        .filter((file) => file.missing)
        .map((file) => ({
          type: "warning",
          badge: "MISSING",
          badgeVariant: "destructive",
          summary: `${event.agent} ${event.hook}: ${file.path}`,
          details: event,
        }));
    }
    case "waiting":
    case "model_usage":
    case "presentation":
    case "tool_output_stored":
    case "interceptor_passed":
    case "rewound": {
      return [];
    }
    case "paused":
    case "resumed": {
      const summary = event.type === "paused" ? "Paused" : "Resumed";
      return [{ type: "warning", badge: "PAUSE", badgeVariant: "amber", summary }];
    }
    case "prompt_delivered": {
      return [
        {
          type: "user_prompt",
          badge: "USER",
          badgeVariant: "sky",
          summary: `(queued) ${event.text}`,
          details: event,
        },
      ];
    }
    case "exit_retry": {
      return [
        {
          type: "warning",
          badge: "RETRY",
          badgeVariant: "amber",
          summary: `Exit criteria not met: ${event.feedback.trim().slice(0, 120)}`,
          details: event,
        },
      ];
    }
    case "settings_changed": {
      return [{ ...SETTINGS_ROW, summary: Object.keys(event.changes).join(", "), details: event }];
    }
    case "warning": {
      const summary = `${event.source}: ${event.message}`;
      return [{ type: "warning", badge: "WARN", badgeVariant: "amber", summary, details: event }];
    }
    case "turn_completed": {
      return [
        {
          type: "turn_complete",
          badge: "DONE",
          badgeVariant: "emerald",
          summary: `Turn complete (retries: ${event.retries})`,
          details: event,
        },
      ];
    }
    case "turn_failed": {
      return [
        event.aborted
          ? {
              type: "warning",
              badge: "STOP",
              badgeVariant: "destructive",
              summary: "Generation stopped by user",
              details: event,
            }
          : {
              type: "error",
              badge: "ERROR",
              badgeVariant: "destructive",
              summary: `Turn failed: ${event.error}`,
              details: event,
            },
      ];
    }
  }
}

export function projectConsoleEvents(event: TurnEvent): ConsoleEvent[] {
  const timestamp = formatClock(new Date(event.at));
  return rows(event).map((row, index) => ({
    ...row,
    id: `evt-${event.turnIndex}-${event.seq}-${index}`,
    timestamp,
  }));
}
