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
    case "governor_action": {
      return `[INTERCEPTOR] ${event.interceptor} ${event.phase} ${event.action.type} ${JSON.stringify(event.action)}`;
    }
    case "governor_verdict": {
      return `[INTERCEPTOR] ${event.interceptor} ${event.phase} finish approved=${event.approved}${event.feedback ? ` feedback="${clip(event.feedback)}"` : ""}`;
    }
    case "governor_inspect": {
      return `[INTERCEPTOR] ${event.interceptor} exit inspect ${event.tool} ${JSON.stringify(event.args)}`;
    }
    case "governor_tool_decision": {
      return `[INTERCEPTOR] ${event.interceptor} pre-tool ${event.approved ? "approved" : "blocked"} ${event.tool}${event.reason ? `: ${event.reason}` : ""}`;
    }
    case "exit_retry": {
      return `[EXIT_RETRY] ${clip(event.feedback, 200)}`;
    }
    case "turn_completed": {
      return `[TURN_SUCCESS] ${turn} finished successfully (retries: ${event.retries}).`;
    }
    case "turn_failed": {
      return `[TURN_ERROR] ${turn} ${event.aborted ? "stopped" : "failed"}: ${event.error}`;
    }
  }
}
