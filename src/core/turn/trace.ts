import type { TurnEvent } from "./events";

function clip(text: string, length = 100): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

export function formatTraceLine(event: TurnEvent): string {
  const turn = `Turn ${event.turnIndex}`;
  switch (event.type) {
    case "turn_started": {
      return event.prompt === null
        ? `[TURN_RESUME] ${turn}: Resuming execution...`
        : `[TURN_START] ${turn}: prompt="${clip(event.prompt)}"`;
    }
    case "model_step": {
      return event.toolCalls.length > 0
        ? `[STEP] Model requested ${event.toolCalls.length} tool(s): ${event.toolCalls.map((t) => t.name).join(", ")} (${event.durationMs}ms)`
        : `[STEP] Model emitted response without tool calls. (${event.durationMs}ms)`;
    }
    case "tool_result": {
      return `[TOOL_RESULT] ${event.name} (${event.toolCallId}): ${clip(event.content)}`;
    }
    case "prompt_requested": {
      return `[PROMPT] ${event.promptId}${event.toolCallId ? ` (${event.toolCallId})` : ""}: ${clip(event.prompt.label)}`;
    }
    case "prompt_answered": {
      return `[PROMPT_ANSWER] ${event.promptId}: ${String(event.value)}`;
    }
    case "governor_action": {
      return `[INTERCEPTOR] ${event.interceptor} ${event.phase} ${event.action.type} ${JSON.stringify(event.action)}`;
    }
    case "governor_verdict": {
      return `[INTERCEPTOR] ${event.interceptor} ${event.phase} finish approved=${event.approved}${event.feedback ? ` feedback="${clip(event.feedback)}"` : ""}`;
    }
    case "governor_brief": {
      return `[GOVERNOR_BRIEF] ${event.interceptor}: ${clip(event.text.replaceAll("\n", " "), 200)}`;
    }
    case "governor_fork": {
      const steps = event.messages.flatMap((message) => {
        if (message.role === "user") return [];
        if (message.role === "tool")
          return [`    -> ${message.name}: ${clip(message.content, 200)}`];
        return [
          ...(message.thinking
            ? [`  thinking: ${clip(message.thinking.replaceAll("\n", " "), 400)}`]
            : []),
          ...(message.content
            ? [`  text: ${clip(message.content.replaceAll("\n", " "), 400)}`]
            : []),
          ...message.toolCalls.map((call) => `  call ${call.name} ${JSON.stringify(call.args)}`),
        ];
      });
      return [`[GOVERNOR_FORK] ${event.interceptor} ${event.pass}`, ...steps].join("\n");
    }
    case "governor_inspect": {
      return `[INTERCEPTOR] ${event.interceptor} exit inspect ${event.tool} ${JSON.stringify(event.args)}`;
    }
    case "governor_tool_decision": {
      return `[INTERCEPTOR] ${event.interceptor} pre-tool ${event.approved ? "approved" : "blocked"} ${event.tool}${event.reason ? `: ${event.reason}` : ""}`;
    }
    case "context_files_loaded": {
      const files = event.files.map((file) => `${file.path}${file.missing ? " (missing)" : ""}`);
      return `[CONTEXT_FILES] ${event.agent} ${event.hook}: ${files.join(", ")}`;
    }
    case "exit_retry": {
      return `[EXIT_RETRY] ${clip(event.feedback, 200)}`;
    }
    case "waiting": {
      return `[WAITING] ${event.on}`;
    }
    case "paused": {
      return `[PAUSED] ${turn}`;
    }
    case "resumed": {
      return `[RESUMED] ${turn}`;
    }
    case "prompt_delivered": {
      return `[PROMPT_DELIVERED] ${event.queueId}: "${clip(event.text)}"`;
    }
    case "warning": {
      return `[WARNING] ${event.source}: ${event.message}`;
    }
    case "turn_completed": {
      return `[TURN_SUCCESS] ${turn} finished successfully (retries: ${event.retries}).`;
    }
    case "turn_failed": {
      return `[TURN_ERROR] ${turn} ${event.aborted ? "stopped" : "failed"}: ${event.error}`;
    }
  }
}
