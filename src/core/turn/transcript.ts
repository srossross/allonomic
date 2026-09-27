import type { ConsoleEvent, ContextMessage, Message, ToolCallInfo } from "../../types";
import type { GovernorState } from "../governor/types";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../governor/reducer";
import { decodeToolResult } from "../userPrompt";
import { projectConsoleEvents } from "./consoleProjection";
import type { TurnEvent, TurnEventOf } from "./events";

export interface Transcript {
  messages: Message[];
  contextMessages: ContextMessage[];
  consoleEvents: ConsoleEvent[];
  governorState: GovernorState;
}

export function emptyTranscript(): Transcript {
  return {
    messages: [],
    contextMessages: [],
    consoleEvents: [],
    governorState: EMPTY_GOVERNOR_STATE,
  };
}

function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((m) => m.id === message.id);
  return index === -1
    ? [...messages, message]
    : messages.map((m, i) => (i === index ? message : m));
}

function withToolResult(call: ToolCallInfo, content: string): ToolCallInfo {
  if (call.status === "blocked") return { ...call, result: content };
  const decoded = decodeToolResult(content);
  return {
    ...call,
    result: content,
    status: decoded.status,
    prompt: decoded.status === "pending" ? decoded.prompt : undefined,
  };
}

function updateToolCall(
  messages: Message[],
  toolCallId: string,
  update: (call: ToolCallInfo) => ToolCallInfo
): Message[] {
  const index = messages.findLastIndex((m) => m.toolCalls?.some((c) => c.id === toolCallId));
  return index === -1
    ? messages
    : messages.map((m, i) =>
        i === index
          ? { ...m, toolCalls: m.toolCalls?.map((c) => (c.id === toolCallId ? update(c) : c)) }
          : m
      );
}

function stepMessage(event: TurnEventOf<"model_step">): Message {
  return {
    id: event.stepId,
    role: "assistant",
    content: event.content,
    thinking: event.thinking,
    thinkingDurationSeconds:
      event.thinking && event.durationMs > 0
        ? Math.max(1, Math.round(event.durationMs / 1000))
        : undefined,
    toolCalls:
      event.toolCalls.length > 0
        ? event.toolCalls.map((c) => ({ id: c.id, name: c.name, args: c.args, status: "running" }))
        : undefined,
  };
}

function applyBody(t: Transcript, event: TurnEvent): Transcript {
  switch (event.type) {
    case "turn_started": {
      if (event.prompt === null) return t;
      return {
        ...t,
        messages: [
          ...t.messages,
          { id: `user-${event.turnIndex}`, role: "user", content: event.prompt },
        ],
        contextMessages: [...t.contextMessages, { role: "human", content: event.prompt }],
      };
    }
    case "model_step": {
      return {
        ...t,
        messages: upsertMessage(t.messages, stepMessage(event)),
        contextMessages: [
          ...t.contextMessages,
          {
            role: "ai",
            content: event.content,
            tool_calls: event.toolCalls.length > 0 ? event.toolCalls : undefined,
            thinking: event.thinking,
          },
        ],
      };
    }
    case "tool_result": {
      return {
        ...t,
        messages: updateToolCall(t.messages, event.toolCallId, (c) =>
          withToolResult(c, event.content)
        ),
        contextMessages: [
          ...t.contextMessages,
          { role: "tool", name: event.name, content: event.content },
        ],
      };
    }
    case "governor_action": {
      return { ...t, governorState: applyGovernorAction(t.governorState, event.action).state };
    }
    case "governor_tool_decision": {
      if (event.approved || !event.toolCallId) return t;
      return {
        ...t,
        messages: updateToolCall(t.messages, event.toolCallId, (c) => ({
          ...c,
          status: "blocked",
          reason: event.reason,
        })),
      };
    }
    case "exit_retry": {
      return {
        ...t,
        contextMessages: [...t.contextMessages, { role: "human", content: event.feedback }],
      };
    }
    case "turn_failed": {
      if (event.aborted) return t;
      return {
        ...t,
        messages: [
          ...t.messages,
          {
            id: `error-${event.turnIndex}-${event.seq}`,
            role: "assistant",
            content: `Error: ${event.error}`,
          },
        ],
      };
    }
    default: {
      return t;
    }
  }
}

export function applyTurnEvent(t: Transcript, event: TurnEvent): Transcript {
  const next = applyBody(t, event);
  return { ...next, consoleEvents: [...next.consoleEvents, ...projectConsoleEvents(event)] };
}

export function foldTurnEvents(
  events: TurnEvent[],
  initial: Transcript = emptyTranscript()
): Transcript {
  let transcript = initial;
  for (const event of events) transcript = applyTurnEvent(transcript, event);
  return transcript;
}
