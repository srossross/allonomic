import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { AgentRunner } from "../../core/graph/runner";
import { GovernorInterceptor } from "../../core/governor/interceptor";
import { ToolTeacherInterceptor } from "../../core/teacher/interceptor";
import { createNodeRuntime } from "../../adapters/node/runtime";
import { loadWorkerPrompt } from "../worker";
import { toContextFiles } from "../../core/contextFiles";
import { resumeFromDir } from "../../core/telemetry/sessionReplay";
import { loadSessionTurns } from "../../core/turn/turnFiles";
import {
  dim,
  cyan,
  red,
  renderEvent,
  renderFalseCompletions,
  setColor,
} from "./conversationRender";
import type { TurnEvent } from "../../core/turn/events";
import type { HistoryEntry } from "../../core/history";
import { SystemMessage } from "@langchain/core/messages";
import { createTurnEventLog } from "../../core/turn/eventLog";
import { historyToMessages } from "../../core/graph/threadState";
import type { PipelineContext } from "../../core/graph/types";
import { answerPromptsWith, isYesFlag } from "./autoAnswer";

const configSchema = z
  .object({
    prompt: z.string().optional(),
    workspace: z.string().optional(),
    stop_after: z.record(z.unknown()).optional(),
    start_at: z.enum(["exit"]).optional(),
  })
  .refine((config) => config.prompt !== undefined || config.start_at !== undefined, {
    message: "conversation.yml needs `prompt` or `start_at`",
  });

function historyEntry(event: TurnEvent): HistoryEntry | null {
  switch (event.type) {
    case "turn_started": {
      return event.prompt === null ? null : { role: "user", content: event.prompt };
    }
    case "model_step": {
      return {
        role: "assistant",
        content: event.content,
        tool_calls: event.toolCalls.length > 0 ? event.toolCalls : undefined,
      };
    }
    case "tool_result": {
      return {
        role: "tool",
        content: event.content,
        tool_call_id: event.toolCallId,
        name: event.name,
      };
    }
    case "exit_retry": {
      return { role: "user", content: event.feedback };
    }
    default: {
      return null;
    }
  }
}

function isMatch(event: TurnEvent, pattern: Record<string, unknown>): boolean {
  const fields: Record<string, unknown> = { ...event };
  return Object.entries(pattern).every(([key, value]) => fields[key] === value);
}

function failOnTurnError(turn: number, error: unknown): never {
  throw new Error(`turn ${turn}: ${String(error)}`, { cause: error });
}

async function main() {
  const cliArguments = process.argv.slice(2);
  const flags = new Set(cliArguments.filter((argument) => argument.startsWith("--")));
  if (flags.has("--color")) setColor(true);
  if (flags.has("--no-color")) setColor(false);
  const isYes = isYesFlag(cliArguments);
  const governorModel = cliArguments
    .find((argument) => argument.startsWith("--governor-model="))
    ?.slice("--governor-model=".length);
  const conversationArgument = cliArguments.find((argument) => !argument.startsWith("--"));
  if (!conversationArgument) {
    throw new Error(
      "usage: bun conversation <conversation-dir> [--color|--no-color] [--governor-model=<id>] [--yes|--no]"
    );
  }
  const conversationDir = path.resolve(conversationArgument);

  const runtime = createNodeRuntime();
  const configText = await runtime.fs.readText(path.join(conversationDir, "conversation.yml"));
  const config = configSchema.parse(YAML.parse(configText));
  const workspaceDir = config.workspace
    ? path.resolve(conversationDir, config.workspace)
    : conversationDir;

  const seed = await resumeFromDir(runtime.fs, conversationDir);
  const { events: seedEvents } = await loadSessionTurns(
    runtime.fs,
    conversationDir,
    failOnTurnError
  );
  const history = seedEvents.map((event) => historyEntry(event)).filter((entry) => entry !== null);

  const sessionId = `run-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  const governor = new GovernorInterceptor({
    runtime,
    initialState: seed.governorState,
    modelName: governorModel,
  });
  const teacher = new ToolTeacherInterceptor({ runtime, modelName: governorModel });
  const workerPrompt = await loadWorkerPrompt(runtime, workspaceDir);
  const runner = new AgentRunner({
    runtime,
    workspaceDir,
    sessionId,
    initialTurnIndex: seed.nextTurnIndex,
    systemPrompt: workerPrompt.prompt,
    contextFiles: toContextFiles(workerPrompt.files),
    interceptors: [teacher, governor],
  });

  console.log(dim(`conversation  ${conversationDir}`));
  console.log(dim(`seed          ${seed.nextTurnIndex - 1} turns, ${history.length} messages`));
  console.log(dim(`run dir       ${runner.getSessionDir()}`));
  if (config.stop_after) console.log(dim(`stop after    ${JSON.stringify(config.stop_after)}`));
  console.log();

  const controller = new AbortController();
  const stopAfter = config.stop_after;
  let isStopped = false;
  const answerPrompt = answerPromptsWith(runner, isYes);
  const onEvent = (event: TurnEvent) => {
    const line = renderEvent(event);
    if (line !== null) console.log(line);
    answerPrompt(event);
    if (isStopped || !stopAfter || !isMatch(event, stopAfter)) return;
    isStopped = true;
    controller.abort();
  };

  try {
    if (config.start_at === "exit") {
      await runExitOnly(governor, runner, history, seed.nextTurnIndex - 1, workspaceDir, onEvent);
    } else {
      await runner.run(config.prompt ?? "", sessionId, {
        history,
        signal: controller.signal,
        onEvent,
      });
    }
  } catch (error) {
    if (!isStopped) throw error;
  }

  console.log(cyan(isStopped ? "\n■ stopped by stop_after" : "\n■ turn completed"));
  console.log(renderFalseCompletions(governor.state));
}

/**
 * Replays the seed as if the worker had just produced its final response for the last recorded
 * turn, then runs only the governor's exit pass over it.
 */
async function runExitOnly(
  governor: GovernorInterceptor,
  runner: AgentRunner,
  history: HistoryEntry[],
  turnIndex: number,
  workspaceDir: string,
  onEvent: (event: TurnEvent) => void
) {
  const { sink } = createTurnEventLog(turnIndex, [onEvent]);
  const context: PipelineContext = {
    workspaceDir,
    threadId: `exit-${turnIndex}`,
    turnIndex,
    events: sink,
    askUser: async () => {
      throw new Error("No user to ask during an exit-only replay");
    },
  };
  const conversation = [new SystemMessage(runner.systemPrompt), ...historyToMessages(history)];
  console.log(cyan(`▶ Exit of turn ${turnIndex}`));
  const verdict = await governor.onAgentFinish(conversation, context);
  console.log(
    verdict.allowFinish ? cyan("  exit approved") : red(`  exit rejected: ${verdict.feedback}`)
  );
  if (verdict.nextStep) console.log(dim(`  next step: ${verdict.nextStep}`));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
