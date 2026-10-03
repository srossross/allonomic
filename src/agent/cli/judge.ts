import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findApiKey } from "../../common/env";
import { invokeWithRetry } from "../../core/retry";
import { DEFAULT_MODEL_ID } from "../../types/chat";
import type { TurnEvent } from "../../core/turn/events";

const judgmentSchema = z.object({
  verdict: z.enum(["pass", "fail", "warn"]),
  reason: z.string(),
});

export type Judgment = z.infer<typeof judgmentSchema>;

const judgeTool = tool(async () => "", {
  name: "judge",
  description:
    "Record your verdict. pass: the expectation is met. fail: it is not met. warn: it is met but with a problem worth reporting.",
  schema: judgmentSchema,
});

const SYSTEM_PROMPT = `You grade a recorded agent session against an expectation.
The session is given as its raw event log, one JSON event per line.
Answer only by calling the judge tool.`;

export async function judgeOplog(
  description: string,
  expectation: string,
  oplog: TurnEvent[],
  modelName = DEFAULT_MODEL_ID
): Promise<Judgment> {
  const apiKey = findApiKey();
  if (!apiKey) throw new Error("Missing Gemini API key for judge");
  const model = new ChatGoogleGenerativeAI({ model: modelName, apiKey, temperature: 0 }).bindTools(
    [judgeTool],
    { tool_choice: "judge" }
  );
  const log = oplog.map((event) => JSON.stringify(event)).join("\n");
  const response = await invokeWithRetry(() =>
    model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `DESCRIPTION:\n${description}\n\nEXPECTATION:\n${expectation}\n\nEVENT LOG:\n${log}`
      ),
    ])
  );
  const call = response.tool_calls?.find((toolCall) => toolCall.name === "judge");
  return call ? judgmentSchema.parse(call.args) : { verdict: "fail", reason: "judge did not return a verdict" };
}
