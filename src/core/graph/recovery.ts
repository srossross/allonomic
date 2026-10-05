import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RecoverableCall, TurnEventSink } from "../turn/events";
import type { AgentInterceptor, PipelineContext } from "./types";
import { preToolDenial, toolContent, withPostToolLessons } from "./interceptorHooks";
import { TOOL_SOURCE } from "../turn/waiting";
import { rethrowIfFatal } from "../tools/fatal";
import { capToolMessage } from "../tools/toolOutputCap";
import { forModel } from "./callIds";

export function emitToolResults(sink: TurnEventSink, messages: ToolMessage[]) {
  for (const message of messages) {
    sink.emit({
      type: "tool_result",
      toolCallId: message.tool_call_id,
      name: message.name ?? "tool",
      content: toolContent(message),
      status: message.status,
    });
  }
}

interface RecoveryPipeline {
  tools: StructuredToolInterface[];
  interceptors: AgentInterceptor[];
  conversation: BaseMessage[];
  context: PipelineContext;
}

async function runTool(
  tools: StructuredToolInterface[],
  call: RecoverableCall,
  context: PipelineContext
): Promise<string> {
  const target = tools.find((t) => t.name === call.name);
  if (!target) return `Error: tool ${call.name} is not available`;
  context.events.emit({ type: "waiting", on: `Running ${call.name}`, source: TOOL_SOURCE });
  try {
    const output: unknown = await target.invoke(
      { ...call, type: "tool_call" },
      { configurable: { context } }
    );
    const content = output instanceof ToolMessage ? output.content : output;
    return typeof content === "string" ? content : JSON.stringify(content);
  } catch (error: unknown) {
    rethrowIfFatal(error);
    return `Error executing ${call.name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function recoverToolCall(
  call: RecoverableCall,
  { tools, interceptors, conversation, context }: RecoveryPipeline
): Promise<ToolMessage> {
  const choice = await context.askUser(
    {
      kind: "choice",
      label: "The app didn't shut down properly while this was running",
      detail: `${call.name}(${JSON.stringify(call.args)})`,
      options: [
        { value: "rerun", label: "Re-run" },
        { value: "skip", label: "Skip" },
      ],
    },
    call.id
  );
  if (choice !== "rerun") {
    return new ToolMessage({
      content: "Not run: the app shut down and the user chose to skip it",
      name: call.name,
      tool_call_id: call.id,
    });
  }
  const denial = await preToolDenial(
    interceptors,
    call,
    conversation,
    context,
    new Set(call.decidedBy)
  );
  if (denial) return denial;
  const content = await runTool(tools, call, context);
  const result = await capToolMessage(
    new ToolMessage({ content, name: call.name, tool_call_id: call.id }),
    context.storeToolOutput
  );
  return await withPostToolLessons(interceptors, call, result, conversation, context);
}

export async function recoverToolCalls(
  calls: RecoverableCall[],
  pipeline: RecoveryPipeline
): Promise<ToolMessage[]> {
  const results: ToolMessage[] = [];
  for (const call of calls) results.push(await recoverToolCall(call, pipeline));
  emitToolResults(pipeline.context.events, results);
  return results.map((result, i) => forModel(result, calls[i].providerId ?? calls[i].id));
}
