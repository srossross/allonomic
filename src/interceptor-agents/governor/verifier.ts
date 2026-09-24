import YAML from "yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { findApiKey } from "../../common/env";
import { GovernorState, GovernorVerdict, verdictSchema } from "./types";

export interface VerifierOptions {
  modelName?: string;
  apiKey?: string;
  constraintsFileContent?: string;
}

export async function verifyConversation(
  conversation: unknown,
  intentState: GovernorState,
  options: VerifierOptions = {}
): Promise<GovernorVerdict> {
  const apiKey = options.apiKey || findApiKey();
  if (!apiKey) throw new Error("Missing Gemini API key for governor verification");

  const model = new ChatGoogleGenerativeAI({
    model: options.modelName ?? "gemini-2.5-flash",
    apiKey,
    temperature: 0,
  }).withStructuredOutput(verdictSchema);

  const baseConstraintsSection = options.constraintsFileContent
    ? `\nBASE PROJECT CONSTRAINTS (from agents/CONSTRAINTS.md):\n${options.constraintsFileContent}\n`
    : "";

  const systemPrompt = `You are the Governor Verifier / Exit Intercept.
Your role is to rigorously evaluate an agent's conversation and tool execution trace against a user's intent stack and constraints.

RULES:
1. Examine the 'intent_stack': Focus on the top intent. Was it genuinely satisfied by the agent's actions/response?
2. Examine the 'constraints' (both intent-specific and global): Were any constraints violated by tool calls or output?
3. If the user asked an exploratory or feasibility question and the agent started attempting file edits or looking for code without permission, that violates 'Do not execute edits without explicit user confirmation'.
4. Examine any BASE PROJECT CONSTRAINTS provided below. If any code changes or responses violate these constraints, FAIL and report the violation with feedback.
5. If FAIL: Provide clear, concise, actionable feedback that will be injected back into the agent to correct its course.
${baseConstraintsSection}`;

  const humanPrompt = `INTENT STATE:
${YAML.stringify(intentState)}

CONVERSATION TRACE:
${YAML.stringify(conversation)}
`;

  const result = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanPrompt),
  ]);

  return verdictSchema.parse(result);
}
