import type { Message } from "@/types";
import type { ToolItem } from "./exploreGroups";

export function isCollapsedWorkerText(message: Message, isTextCollapsed: boolean) {
  return (
    isTextCollapsed && message.role === "assistant" && !message.isError && !message.presentation
  );
}

export function streamRowCount(message: Message, toolItems: ToolItem[], isTextCollapsed: boolean) {
  const isAssistant = message.role === "assistant";
  return (
    Number(isAssistant && Boolean(message.thinking)) +
    (isAssistant ? toolItems.length : 0) +
    Number(Boolean(message.brief)) +
    Number(Boolean(message.content) && isCollapsedWorkerText(message, isTextCollapsed))
  );
}
