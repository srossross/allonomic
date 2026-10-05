import type {
  AgentFileRow,
  ConsoleEvent,
  ContextMessage,
  Message,
  PendingPrompt,
  ToolCallInfo,
} from "../../types";
import type { GovernorState } from "../governor/types";
import { applyGovernorAction, EMPTY_GOVERNOR_STATE } from "../governor/reducer";
import { decodeToolResult } from "../userPrompt";
import { projectConsoleEvents } from "./consoleProjection";
import { applyAgentFiles } from "./agentFiles";
import { exitMarkerMessage, popMarkerMessage } from "./governorMarkers";
import type { TurnEvent, TurnEventOf } from "./events";
import { applyProfileEvent, EMPTY_PROFILE, type Profile } from "./profile";
import { addModelUsage, type TokenUsage } from "./usage";
import { nextPendingPrompt, nextWaitingOn } from "./transcriptStatus";
import { applyTurnTreeEvent, EMPTY_TURN_TREE, type TurnTree } from "./branches";

export interface Transcript {
  messages: Message[];
  contextMessages: ContextMessage[];
  consoleEvents: ConsoleEvent[];
  agentFiles: AgentFileRow[];
  governorState: GovernorState;
  contextTokens?: number;
  tokenUsage: TokenUsage;
  waitingOn?: string;
  pendingPrompt?: PendingPrompt;
  profile: Profile;
  turnTree: TurnTree;
}

export function emptyTranscript(): Transcript {
  return {
    messages: [],
    contextMessages: [],
    consoleEvents: [],
    agentFiles: [],
    governorState: EMPTY_GOVERNOR_STATE,
    tokenUsage: [],
    profile: EMPTY_PROFILE,
    turnTree: EMPTY_TURN_TREE,
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
  return {
    ...call,
    result: content,
    status: decodeToolResult(content).status,
    prompt: undefined,
    promptId: undefined,
  };
}

function updateMatchingToolCall(
  messages: Message[],
  isMatch: (call: ToolCallInfo) => boolean,
  update: (call: ToolCallInfo) => ToolCallInfo
): Message[] {
  const index = messages.findLastIndex((m) => m.toolCalls?.some((c) => isMatch(c)));
  return index === -1
    ? messages
    : messages.map((m, i) =>
        i === index ? { ...m, toolCalls: m.toolCalls?.map((c) => (isMatch(c) ? update(c) : c)) } : m
      );
}

function updateToolCall(
  messages: Message[],
  toolCallId: string,
  update: (call: ToolCallInfo) => ToolCallInfo
): Message[] {
  return updateMatchingToolCall(messages, (c) => c.id === toolCallId, update);
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
        ? event.toolCalls.map((c) => ({
            id: c.id,
            name: c.name,
            args: c.args,
            thoughtSignature: c.thoughtSignature,
            status: "running",
          }))
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
          {
            id: `user-${event.turnIndex}`,
            role: "user",
            content: event.prompt,
            turnIndex: event.turnIndex,
          },
        ],
        contextMessages: [...t.contextMessages, { role: "human", content: event.prompt }],
      };
    }
    case "model_step": {
      return {
        ...t,
        contextTokens: event.inputTokens ?? t.contextTokens,
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
    case "model_usage": {
      return { ...t, tokenUsage: addModelUsage(t.tokenUsage, event) };
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
    case "prompt_requested": {
      const { toolCallId, prompt, promptId } = event;
      if (!toolCallId) return t;
      return {
        ...t,
        messages: updateToolCall(t.messages, toolCallId, (c) => ({
          ...c,
          status: "pending",
          prompt,
          promptId,
        })),
      };
    }
    case "prompt_answered": {
      return {
        ...t,
        messages: updateMatchingToolCall(
          t.messages,
          (c) => c.promptId === event.promptId,
          (c) => ({ ...c, status: "running", prompt: undefined, promptId: undefined })
        ),
      };
    }
    case "governor_action": {
      const { state, result } = applyGovernorAction(t.governorState, event.action);
      const marker = popMarkerMessage(event, result);
      return {
        ...t,
        governorState: state,
        messages: marker ? [...t.messages, marker] : t.messages,
      };
    }
    case "governor_verdict": {
      return event.phase === "exit"
        ? { ...t, messages: [...t.messages, exitMarkerMessage(t.governorState, t.messages, event)] }
        : t;
    }
    case "governor_tool_decision": {
      if (event.approved || !event.toolCallId) return t;
      return {
        ...t,
        messages: updateToolCall(t.messages, event.toolCallId, (c) => ({
          ...c,
          status: "blocked",
          reason: event.reason,
          blockedBy: event.interceptor,
        })),
      };
    }
    case "governor_brief": {
      const content = `[${event.interceptor}]: ${event.text}`;
      return {
        ...t,
        messages: [
          ...t.messages,
          {
            id: `brief-${event.turnIndex}-${event.seq}`,
            role: "user",
            content,
            brief: { interceptor: event.interceptor, text: event.text, doneWhen: event.doneWhen },
          },
        ],
        contextMessages: [...t.contextMessages, { role: "human", content }],
      };
    }
    case "presentation": {
      return {
        ...t,
        messages: [
          ...t.messages,
          {
            id: `presentation-${event.turnIndex}-${event.seq}`,
            role: "assistant",
            content: "",
            presentation: event.presentation,
          },
        ],
      };
    }
    case "prompt_delivered": {
      return {
        ...t,
        messages: [
          ...t.messages,
          {
            id: `user-${event.turnIndex}-${event.seq}`,
            role: "user",
            content: event.text,
            isQueued: true,
          },
        ],
        contextMessages: [...t.contextMessages, { role: "human", content: event.text }],
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
            isError: true,
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
  return {
    ...next,
    consoleEvents: [...next.consoleEvents, ...projectConsoleEvents(event)],
    agentFiles: applyAgentFiles(next.agentFiles, event),
    waitingOn: nextWaitingOn(next.waitingOn, event),
    pendingPrompt: nextPendingPrompt(next.pendingPrompt, event),
    profile: applyProfileEvent(next.profile, event),
    turnTree: applyTurnTreeEvent(next.turnTree, event),
  };
}

export function foldTurnEvents(
  events: TurnEvent[],
  initial: Transcript = emptyTranscript()
): Transcript {
  let transcript = initial;
  for (const event of events) transcript = applyTurnEvent(transcript, event);
  return transcript;
}
