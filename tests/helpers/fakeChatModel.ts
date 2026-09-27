import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { ToolCall } from "@langchain/core/messages/tool";

export type ScriptedTurn = string | { content?: string; toolCalls: ToolCall[] };

export class FakeChatModel extends BaseChatModel {
  private queue: ScriptedTurn[];
  readonly calls: BaseMessage[][] = [];

  constructor(script: ScriptedTurn[], params: BaseChatModelParams = {}) {
    super(params);
    this.queue = [...script];
  }

  _llmType(): string {
    return "fake";
  }

  bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(`FakeChatModel script exhausted after ${this.calls.length} call(s)`);
    }
    const turn = typeof next === "string" ? { content: next, toolCalls: [] } : next;
    const message = new AIMessage({ content: turn.content ?? "", tool_calls: turn.toolCalls });
    return { generations: [{ text: turn.content ?? "", message }] };
  }
}

export function toolCall(name: string, args: Record<string, unknown>, id: string): ToolCall {
  return { name, args, id, type: "tool_call" };
}
