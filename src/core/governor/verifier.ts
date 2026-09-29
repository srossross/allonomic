import YAML from "yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { findApiKey } from "../../common/env";
import { invokeWithRetry } from "../retry";
import { GovernorState, GovernorVerdict, verdictSchema } from "./types";

export interface VerifierOptions {
  modelName?: string;
  apiKey?: string;
}

export async function verifyConversation(
  conversation: unknown,
  intentState: GovernorState,
  options: VerifierOptions = {}
): Promise<GovernorVerdict> {
  const apiKey = options.apiKey || findApiKey();
  if (!apiKey) throw new Error("Missing Gemini API key for governor verification");

  const model = new ChatGoogleGenerativeAI({
    model: options.modelName ?? "gemini-3.8-flash",
    apiKey,
    temperature: 0,
  }).withStructuredOutput(verdictSchema);

  const systemPrompt = `You are the Governor Verifier / Exit Intercept.
Your role is to rigorously evaluate an agent's conversation and tool execution trace against a user's intent stack.

RULES:
1. Examine the 'intent_stack': Focus on the top intent. Was it genuinely satisfied by the agent's actions/response?
2. If FAIL: Provide clear, concise, actionable feedback that will be injected back into the agent to correct its course.
`;

  const humanPrompt = `INTENT STATE:
${YAML.stringify(intentState)}

CONVERSATION TRACE:
${YAML.stringify(conversation)}
`;

  const result = await invokeWithRetry(() =>
    model.invoke([new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)])
  );

  return verdictSchema.parse(result);
}
