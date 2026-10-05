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
import { emitModelUsage, interceptorAgent } from "../turn/usage";
import { sanitizeMessagesForModel } from "../graph/thinking";
import { createLogger } from "../log";

const GOVERNOR_MAX_STEPS = 50;

const forkLog = createLogger("governor.fork");

export interface GovernorModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage | AIMessageChunk>;
}

export interface ForkLoopOptions<T> {
  scratchpad: BaseMessage[];
  label: string;
  model: GovernorModel;
  modelName: string;
  usageAgent?: string;
  tools: StructuredTool[];
  decision: () => T | null;
  nudge?: string;
  unknownTool?: (name: string) => string;
  waiting?: WaitingTarget;
  sessionId?: string;
}

/**
 * Drives one governor pass: invoke, run every requested tool, append results, repeat until
 * `decision()` is non-null. Mutates and returns `scratchpad`.
 */
export async function loopFork<T>({
  scratchpad,
  label,
  model,
  modelName,
  usageAgent,
  tools,
  decision,
  nudge,
  waiting,
  sessionId,
  unknownTool = (name) =>
    `Error: you do not have the tool ${name}. The tools used in the conversation above have been removed.`,
}: ForkLoopOptions<T>): Promise<{ decided: T; scratchpad: BaseMessage[] }> {
  const log = sessionId ? forkLog.child({ sessionId }) : forkLog;
  for (let step = 0; step < GOVERNOR_MAX_STEPS; step++) {
    const decided = decision();
    if (decided !== null) {
      log.debug({ label, step }, "decided");
      return { decided, scratchpad };
    }

    const invoke = () => model.invoke(sanitizeMessagesForModel(scratchpad));
    const startedAt = Date.now();
    log.debug({ label, step, messages: scratchpad.length }, "invoke start");
    const response = await (waiting
      ? invokeWaiting(waiting, label, invoke)
      : invokeWithRetry(invoke));
    if (waiting)
      emitModelUsage(
        waiting.events,
        usageAgent ?? interceptorAgent(waiting.source),
        modelName,
        response
      );
    log.debug(
      {
        label,
        step,
        durationMs: Date.now() - startedAt,
        toolCalls: (response.tool_calls ?? []).map((call) => call.name),
      },
      "invoke done"
    );
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
        log.debug({ label, step, tool: call.name }, "tool start");
        try {
          result = await matchingTool.invoke(call.args);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        log.debug({ label, step, tool: call.name }, "tool done");
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
  log.error({ label, steps: GOVERNOR_MAX_STEPS }, "no decision");
  throw new Error(`${label} fork made no decision within ${GOVERNOR_MAX_STEPS} steps`);
}
