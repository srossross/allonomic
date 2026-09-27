import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { GovernorModel } from "../../src/core/governor/interceptor";

type ScriptedCall = { name: string; args?: Record<string, unknown> } | null;

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
        return new AIMessage({
          content: "",
          tool_calls: call ? [{ id: `gov_${index}`, name: call.name, args: call.args ?? {} }] : [],
        });
      },
    }),
    calls: () => index,
  };
}
