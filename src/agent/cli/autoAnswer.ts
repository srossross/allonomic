import type { AgentRunner } from "../../core/graph/runner";
import type { TurnEvent } from "../../core/turn/events";
import type { UserPrompt, UserPromptValue } from "../../types";

export function isYesFlag(cliArguments: string[]): boolean {
  const isNo = cliArguments.includes("--no");
  if (isNo && cliArguments.includes("--yes")) throw new Error("pass only one of --yes or --no");
  return !isNo;
}

function autoAnswer(prompt: UserPrompt, isYes: boolean): UserPromptValue {
  if (prompt.kind === "confirm") return isYes;
  throw new Error(`--yes/--no cannot answer a ${prompt.kind} prompt: ${prompt.label}`);
}

export function answerPromptsWith(runner: AgentRunner, isYes: boolean) {
  return (event: TurnEvent) => {
    if (event.type !== "prompt_requested") return;
    queueMicrotask(() => runner.answerPrompt(event.promptId, autoAnswer(event.prompt, isYes)));
  };
}
