import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { thinkingConfigFor } from "./thinking";
import type { WorkflowModel } from "./workflow";

export function createGeminiModel(
  apiKey: string,
  modelName: string,
  thinkingBudget: number | undefined,
  tools: StructuredToolInterface[]
): WorkflowModel {
  const thinkingConfig = thinkingConfigFor(thinkingBudget);
  const baseModel = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
    temperature: 0.2,
    ...(thinkingConfig && { thinkingConfig }),
  });
  return tools.length > 0 ? baseModel.bindTools(tools) : baseModel;
}
