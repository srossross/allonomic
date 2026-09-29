import { isAIMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { extractThinking, messageText } from "../graph/thinking";
import type { GovernorForkMessage } from "../turn/events";

export function toForkMessages(messages: BaseMessage[]): GovernorForkMessage[] {
  return messages.map((message): GovernorForkMessage => {
    if (isAIMessage(message)) {
      const thinking = extractThinking(message);
      return {
        role: "ai",
        content: messageText(message.content),
        thinking: thinking || undefined,
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          id: call.id ?? "",
          name: call.name,
          args: call.args,
        })),
      };
    }
    if (isToolMessage(message)) {
      return {
        role: "tool",
        toolCallId: message.tool_call_id,
        name: message.name ?? "",
        content: messageText(message.content),
      };
    }
    return { role: "user", content: messageText(message.content) };
  });
}
