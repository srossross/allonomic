import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { thoughtSignatureKwargs } from "../graph/thinking";
import { callIdKwargs, forModel } from "../graph/callIds";
import { turnPromptMessage, userPromptMessage } from "../graph/userPrompt";
import type { TurnEvent } from "./events";

export interface Brief {
  interceptor: string;
  text: string;
}

export function briefText(briefs: Brief[]): string {
  return briefs.map(({ interceptor, text }) => `[${interceptor}]: ${text}`).join("\n\n");
}

export function exitRetryText(feedback: string): string {
  return `Your output did not satisfy the exit criteria:${feedback}\nPlease address this feedback to complete the task.`;
}

function opMessage(event: TurnEvent, providerIds: Map<string, string>): BaseMessage | undefined {
  switch (event.type) {
    case "turn_started": {
      return event.prompt === null ? undefined : turnPromptMessage(event.prompt);
    }
    case "prompt_delivered": {
      return userPromptMessage(event.text, { queueId: event.queueId });
    }
    case "model_step": {
      const calls = event.toolCalls.map((call) => ({ ...call, id: call.providerId ?? call.id }));
      for (const call of event.toolCalls) providerIds.set(call.id, call.providerId ?? call.id);
      return new AIMessage({
        id: event.stepId,
        content: event.content,
        tool_calls: calls.map(({ id, name, args }) => ({ id, name, args })),
        additional_kwargs:
          calls.length > 0
            ? {
                ...callIdKwargs(event.toolCalls.map((call) => call.id)),
                ...thoughtSignatureKwargs(calls),
              }
            : {},
      });
    }
    case "tool_result": {
      return forModel(
        new ToolMessage({
          content: event.content,
          name: event.name,
          tool_call_id: event.toolCallId,
          status: event.status,
        }),
        providerIds.get(event.toolCallId)
      );
    }
    case "exit_retry": {
      return new HumanMessage(exitRetryText(event.feedback));
    }
    default: {
      return undefined;
    }
  }
}

export function replayWorkerMessages(events: TurnEvent[]): BaseMessage[] {
  const messages: BaseMessage[] = [];
  const providerIds = new Map<string, string>();
  let briefs: Brief[] = [];
  const flushBriefs = () => {
    if (briefs.length > 0) messages.push(new HumanMessage(briefText(briefs)));
    briefs = [];
  };
  for (const event of events) {
    if (event.type === "governor_brief") {
      briefs.push(event);
      continue;
    }
    const message = opMessage(event, providerIds);
    if (!message) continue;
    flushBriefs();
    messages.push(message);
  }
  flushBriefs();
  return messages;
}
