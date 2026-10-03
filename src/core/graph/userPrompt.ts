import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { messageText } from "./thinking";

export function userPromptMessage(
  content: string,
  additional_kwargs: Record<string, unknown> = {}
): HumanMessage {
  return new HumanMessage({
    content,
    additional_kwargs: { ...additional_kwargs, userPrompt: true },
  });
}

export function turnPromptMessage(prompt: string): HumanMessage {
  return prompt ? userPromptMessage(prompt) : new HumanMessage(prompt);
}

export function isUserPrompt(message: BaseMessage): boolean {
  return message.type === "human" && message.additional_kwargs.userPrompt === true;
}

export function lastUserPrompt(messages: BaseMessage[]): string | undefined {
  const message = messages.findLast((m) => isUserPrompt(m));
  return message && messageText(message.content);
}
