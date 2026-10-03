import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { findApiKey } from "../../common/env";
import { invokeWithRetry } from "../retry";
import { messageText } from "../graph/thinking";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import type { AgentInterceptor, ExitVerdict, PipelineContext } from "../graph/types";

export interface ExitProbeOptions {
  name: string;
  prompt: string;
  modelName?: string;
}

export class ExitProbeInterceptor implements AgentInterceptor {
  private readonly prompt: string;
  private readonly modelName: string;
  public readonly name: string;
  public readonly description = "Asks a fixed question at exit and records the answer";

  constructor(options: ExitProbeOptions) {
    this.name = options.name;
    this.prompt = options.prompt;
    this.modelName = options.modelName ?? DEFAULT_MODEL_ID;
  }

  getModelName() {
    return this.modelName;
  }

  async onAgentFinish(conversation: BaseMessage[], context: PipelineContext): Promise<ExitVerdict> {
    const apiKey = findApiKey();
    if (!apiKey) throw new Error(`Missing Gemini API key for ${this.name}`);
    const model = new ChatGoogleGenerativeAI({ model: this.modelName, apiKey });
    const response = await invokeWithRetry(() =>
      model.invoke([...conversation, new HumanMessage(this.prompt)])
    );
    context.events.emit({
      type: "governor_fork",
      interceptor: this.name,
      phase: "exit",
      pass: "probe",
      messages: [
        { role: "user", content: this.prompt },
        { role: "ai", content: messageText(response.content), toolCalls: [] },
      ],
    });
    return { allowFinish: true };
  }
}
