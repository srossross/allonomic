import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ScopeOptions } from "../turn/events";
import {
  INTERCEPTOR_HOOKS,
  type AgentInterceptor,
  type InterceptorInfo,
  type PipelineContext,
  type ToolCall,
} from "./types";

export function describeInterceptor(interceptor: AgentInterceptor): InterceptorInfo {
  return {
    name: interceptor.name,
    description: interceptor.description ?? "",
    modelName: interceptor.getModelName?.(),
    isEnabled: interceptor.getIsEnabled?.() ?? true,
    hooks: INTERCEPTOR_HOOKS.filter((hook) => typeof interceptor[hook] === "function").map(
      (hook) => ({ hook, description: interceptor.hookDescriptions?.[hook] ?? "" })
    ),
  };
}

export function toolContent(message: ToolMessage): string {
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

export async function inScope<T>(
  context: PipelineContext,
  interceptor: AgentInterceptor,
  options: ScopeOptions,
  run: (scoped: PipelineContext) => Promise<T>,
  isPassThrough: (result: T) => boolean
): Promise<T> {
  const events = context.events.scope(interceptor.name, options);
  try {
    const result = await run({ ...context, events });
    events.close({ collapse: isPassThrough(result) });
    return result;
  } finally {
    events.close();
  }
}

export async function preToolDenial(
  interceptors: AgentInterceptor[],
  call: ToolCall,
  conversation: BaseMessage[],
  context: PipelineContext,
  decidedBy: ReadonlySet<string> = new Set()
): Promise<ToolMessage | null> {
  for (const interceptor of interceptors) {
    const { onPreToolCall } = interceptor;
    if (!onPreToolCall || decidedBy.has(interceptor.name)) continue;
    const approval = await inScope(
      context,
      interceptor,
      { phase: "pre_tool", toolCallId: call.id },
      (scoped) => onPreToolCall.call(interceptor, call, conversation, scoped),
      (result) => result.approved
    );
    if (!approval.approved) {
      return new ToolMessage({
        status: "error",
        content: `[INTERCEPTED by ${interceptor.name}]: ${approval.reason}`,
        tool_call_id: call.id ?? "",
        name: call.name,
      });
    }
  }
  return null;
}

export async function withPostToolLessons(
  interceptors: AgentInterceptor[],
  call: ToolCall,
  result: ToolMessage,
  conversation: BaseMessage[],
  context: PipelineContext
): Promise<ToolMessage> {
  let current = result;
  for (const interceptor of interceptors) {
    const { onPostToolCall } = interceptor;
    if (!onPostToolCall) continue;
    const input = current;
    const lesson = await inScope(
      context,
      interceptor,
      { phase: "post_tool", toolCallId: call.id },
      (scoped) => onPostToolCall.call(interceptor, call, input, conversation, scoped),
      (taught) => !taught
    );
    if (!lesson) continue;
    current = new ToolMessage({
      status: current.status,
      content: `${toolContent(current)}\n\n[${interceptor.name}]: ${lesson}`,
      tool_call_id: current.tool_call_id,
      name: current.name,
    });
  }
  return current;
}
