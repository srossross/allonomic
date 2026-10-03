import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentRunner } from "../../core/graph/runner";
import type { AgentInterceptor, PipelineContext } from "../../core/graph/types";
import { inScope } from "../../core/graph/interceptorHooks";
import { stripThinking } from "../../core/graph/thinking";
import { createTurnEventLog } from "../../core/turn/eventLog";
import type { TurnEvent } from "../../core/turn/events";
import { PromptBroker } from "../../core/graph/promptBroker";
import type { UserPrompt, UserPromptValue } from "../../types";
import { cyan, red } from "./conversationRender";

/**
 * Replays the seed as if the worker had just produced its final response for the last recorded
 * turn, then runs only the exit and present hooks over it.
 */
export async function runExitOnly(
  interceptors: AgentInterceptor[],
  runner: AgentRunner,
  history: BaseMessage[],
  turnIndex: number,
  workspaceDir: string,
  onEvent: (event: TurnEvent) => void,
  answer: (prompt: UserPrompt) => UserPromptValue
) {
  const broker = new PromptBroker();
  const answerRequested = (event: TurnEvent) => {
    if (event.type !== "prompt_requested") return;
    const value = answer(event.prompt);
    queueMicrotask(() => broker.answer(event.promptId, value));
  };
  const { sink } = createTurnEventLog(turnIndex, [onEvent, answerRequested]);
  const context: PipelineContext = {
    workspaceDir,
    threadId: `exit-${turnIndex}`,
    turnIndex,
    events: sink,
    askUser: broker.createAskUser(sink, new AbortController().signal),
  };
  const conversation = [new SystemMessage(runner.systemPrompt), ...stripThinking(history)];
  console.log(cyan(`▶ Exit of turn ${turnIndex}`));
  let isRejected = false;
  for (const interceptor of interceptors) {
    const { onAgentFinish } = interceptor;
    if (!onAgentFinish) continue;
    const verdict = await inScope(
      context,
      interceptor,
      { phase: "exit" },
      (scoped) => onAgentFinish.call(interceptor, conversation, scoped),
      (result) => result.allowFinish
    );
    if (verdict.allowFinish) continue;
    isRejected = true;
    console.log(red(`  ${interceptor.name} rejected exit: ${verdict.feedback ?? ""}`));
  }
  if (isRejected) return;
  console.log(cyan("  exit approved"));
  for (const interceptor of interceptors) {
    const { onPresent } = interceptor;
    if (!onPresent) continue;
    await inScope(
      context,
      interceptor,
      { phase: "present" },
      (scoped) => onPresent.call(interceptor, conversation, scoped),
      () => false
    );
  }
}
