import {
  HumanMessage,
  ToolMessage,
  type AIMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { invokeWithRetry } from "../retry";
import { invokeWaiting, type WaitingTarget } from "../turn/waiting";
import { sanitizeMessagesForModel } from "../graph/thinking";

const GOVERNOR_MAX_STEPS = 50;

export interface GovernorModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage | AIMessageChunk>;
}

export interface ForkLoopOptions<T> {
  scratchpad: BaseMessage[];
  label: string;
  model: GovernorModel;
  tools: StructuredTool[];
  decision: () => T | null;
  nudge?: string;
  unknownTool?: (name: string) => string;
  waiting?: WaitingTarget;
}

/**
 * Drives one governor pass: invoke, run every requested tool, append results, repeat until
 * `decision()` is non-null. Mutates and returns `scratchpad`.
 */
export async function loopFork<T>({
  scratchpad,
  label,
  model,
  tools,
  decision,
  nudge,
  waiting,
  unknownTool = (name) =>
    `Error: you do not have the tool ${name}. The tools used in the conversation above have been removed.`,
}: ForkLoopOptions<T>): Promise<{ decided: T; scratchpad: BaseMessage[] }> {
  for (let step = 0; step < GOVERNOR_MAX_STEPS; step++) {
    const decided = decision();
    if (decided !== null) return { decided, scratchpad };

    const invoke = () => model.invoke(sanitizeMessagesForModel(scratchpad));
    const response = await (waiting
      ? invokeWaiting(waiting, label, invoke)
      : invokeWithRetry(invoke));
    scratchpad.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      scratchpad.push(new HumanMessage(nudge ?? "Continue."));
      continue;
    }

    for (const [callIndex, call] of response.tool_calls.entries()) {
      call.id ??= `call_${Date.now()}_${callIndex}`;
      const matchingTool = tools.find((t) => t.name === call.name);
      let result: unknown;
      if (matchingTool) {
        try {
          result = await matchingTool.invoke(call.args);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        result = unknownTool(call.name);
      }
      scratchpad.push(
        new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        })
      );
    }
  }

  const decided = decision();
  if (decided !== null) return { decided, scratchpad };
  throw new Error(`${label} fork made no decision within ${GOVERNOR_MAX_STEPS} steps`);
}
