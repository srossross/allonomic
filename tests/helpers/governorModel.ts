import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { GovernorModel } from "../../src/core/governor/interceptor";

type ScriptedArgs = Record<string, unknown> | (() => Record<string, unknown>);

type ScriptedCall = { name: string; args?: ScriptedArgs } | { text: string } | null;

export function scriptedGovernorModel(script: ScriptedCall[]): {
  createModel: () => GovernorModel;
  calls: () => number;
  inputs: BaseMessage[][];
} {
  let index = 0;
  const inputs: BaseMessage[][] = [];
  return {
    inputs,
    createModel: () => ({
      invoke: async (messages) => {
        inputs.push([...messages]);
        const call = script[index++] ?? null;
        if (call && "text" in call) return new AIMessage({ content: call.text, tool_calls: [] });
        return new AIMessage({
          content: "",
          tool_calls: call
            ? [
                {
                  id: `gov_${index}`,
                  name: call.name,
                  args: typeof call.args === "function" ? call.args() : (call.args ?? {}),
                },
              ]
            : [],
        });
      },
    }),
    calls: () => index,
  };
}
