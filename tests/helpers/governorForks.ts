import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { GovernorInterceptor } from "../../src/core/governor/interceptor";
import { createMemoryRuntime } from "../../src/adapters/memory/runtime";
import { messageText } from "../../src/core/graph/thinking";
import type { TurnEvent } from "../../src/core/turn/events";
import { scriptedGovernorModel } from "./governorModel";

const STUB_PROMPTS: Record<string, string> = {
  "preamble.md": "PREAMBLE",
  "entry.md": "ENTRY",
  "exit.md": "EXIT",
  "false_completion.md": "FC_LIST",
  "false_completion_merge.md": "FC_MERGE",
};

export type MemoryRuntime = ReturnType<typeof createMemoryRuntime>;

export async function stubPromptRuntime(): Promise<MemoryRuntime> {
  const runtime = createMemoryRuntime();
  for (const [name, text] of Object.entries(STUB_PROMPTS)) {
    await runtime.fs.writeText(`/resources/app-data/prompts/governor/${name}`, text);
  }
  return runtime;
}

export function scriptedGovernor(
  runtime: MemoryRuntime,
  script: Parameters<typeof scriptedGovernorModel>[0],
  options: Partial<ConstructorParameters<typeof GovernorInterceptor>[0]> = {}
) {
  const model = scriptedGovernorModel(script);
  const governor = new GovernorInterceptor({
    runtime,
    apiKey: "test",
    createModel: model.createModel,
    ...options,
  });
  return { model, governor };
}

export const workerConversation: BaseMessage[] = [
  new SystemMessage("worker system prompt"),
  new HumanMessage("add a box"),
  new AIMessage("added a box"),
];

type ForkEvent = Extract<TurnEvent, { type: "governor_fork" }>;

export const forks = (events: TurnEvent[]) =>
  events.filter((e): e is ForkEvent => e.type === "governor_fork");

export const passes = (events: TurnEvent[]) => forks(events).map((e) => e.pass);

export const instructionsOf = (events: TurnEvent[], pass: string) =>
  forks(events).find((e) => e.pass === pass)?.messages[0]?.content ?? "";

export const texts = (messages: BaseMessage[]) => messages.map((m) => messageText(m.content));

export const firstInputFor = (inputs: BaseMessage[][], marker: string) =>
  inputs.find((messages) => messageText(messages.at(-1)!.content).includes(marker)) ?? [];
