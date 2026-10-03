import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { thoughtSignatureKwargs } from "../graph/thinking";
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

function opMessage(event: TurnEvent): BaseMessage | undefined {
  switch (event.type) {
    case "turn_started": {
      return event.prompt === null ? undefined : turnPromptMessage(event.prompt);
    }
    case "prompt_delivered": {
      return userPromptMessage(event.text, { queueId: event.queueId });
    }
    case "model_step": {
      return new AIMessage({
        id: event.stepId,
        content: event.content,
        tool_calls: event.toolCalls.map(({ id, name, args }) => ({ id, name, args })),
        additional_kwargs:
          event.toolCalls.length > 0 ? thoughtSignatureKwargs(event.toolCalls) : {},
      });
    }
    case "tool_result": {
      return new ToolMessage({
        content: event.content,
        name: event.name,
        tool_call_id: event.toolCallId,
        status: event.status,
      });
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
    const message = opMessage(event);
    if (!message) continue;
    flushBriefs();
    messages.push(message);
  }
  flushBriefs();
  return messages;
}
