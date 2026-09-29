import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
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

export async function preToolDenial(
  interceptors: AgentInterceptor[],
  call: ToolCall,
  conversation: BaseMessage[],
  context: PipelineContext,
  decidedBy: ReadonlySet<string> = new Set()
): Promise<ToolMessage | null> {
  for (const interceptor of interceptors) {
    if (!interceptor.onPreToolCall || decidedBy.has(interceptor.name)) continue;
    const approval = await interceptor.onPreToolCall(call, conversation, context);
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
    if (!interceptor.onPostToolCall) continue;
    const lesson = await interceptor.onPostToolCall(call, current, conversation, context);
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
