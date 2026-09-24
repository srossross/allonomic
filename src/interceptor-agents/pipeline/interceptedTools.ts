import { tool, StructuredTool, type ToolRunnableConfig } from "@langchain/core/tools";
import { AgentInterceptor, PipelineContext } from "./types";

interface InterceptedToolsOptions {
  tools: StructuredTool[];
  interceptors: AgentInterceptor[];
  workspaceDir: string;
  sessionId: string;
  turnIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createInterceptedTools({
  tools,
  interceptors,
  workspaceDir,
  sessionId,
  turnIndex,
}: InterceptedToolsOptions): StructuredTool[] {
  return tools.map((rawTool) => {
    return tool(
      async (arguments_: unknown, config?: ToolRunnableConfig) => {
        const threadId =
          isRecord(config) &&
          isRecord(config.configurable) &&
          typeof config.configurable.thread_id === "string"
            ? config.configurable.thread_id
            : "default";

        const context: PipelineContext = {
          workspaceDir,
          threadId,
          sessionId,
          turnIndex,
        };

        const args = isRecord(arguments_) ? arguments_ : {};

        // Run Pre-Tool Interceptors
        for (const interceptor of interceptors) {
          if (!interceptor.onPreToolCall) {
            continue;
          }

          const approval = await interceptor.onPreToolCall({ name: rawTool.name, args }, context);
          if (!approval.approved) {
            return `[INTERCEPTED by ${interceptor.name}]: ${approval.reason}`;
          }
        }

        // Execute the tool if approved
        return await rawTool.invoke(arguments_, config);
      },
      {
        name: rawTool.name,
        description: rawTool.description,
        schema: rawTool.schema,
      }
    );
  });
}
