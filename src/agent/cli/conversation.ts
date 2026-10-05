import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { AgentRunner } from "../../core/graph/runner";
import { GovernorInterceptor } from "../../core/governor/interceptor";
import { ToolTeacherInterceptor } from "../../core/teacher/interceptor";
import { UiInterceptor } from "../../core/ui/interceptor";
import { createNodeRuntime } from "../../adapters/node/runtime";
import { loadWorkerPrompt } from "../worker";
import { toContextFiles } from "../../core/contextFiles";
import { replayGovernorState } from "../../core/session/rehydration";
import { replayWorkerMessages } from "../../core/turn/ops";
import {
  listSegmentFiles,
  loadSessionTurns,
  loadTurn,
  nextTurnIndexAfter,
  turnDirFor,
} from "../../core/turn/turnFiles";
import {
  bold,
  dim,
  cyan,
  green,
  red,
  yellow,
  renderEvent,
  renderAssumptions,
  setColor,
} from "./conversationRender";
import type { TurnEvent } from "../../core/turn/events";
import type { AgentInterceptor } from "../../core/graph/types";
import { runExitOnly } from "./exitReplay";
import { ExitProbeInterceptor } from "../../core/probe/interceptor";
import type { Runtime } from "../../core/ports";
import { answerPromptsWith, autoAnswer, isYesFlag } from "./autoAnswer";
import { judgeOplog, type Judgment } from "./judge";

const USAGE =
  "usage: bun conversation <conversation-dir | expectation.yml> [--color|--no-color] [--governor-model=<id>] [--judge-model=<id>] [--strict] [--yes|--no]";

const EXIT_SEGMENT_SUFFIX = "-governor-exit.jsonl";

const eventPatternSchema = z.record(z.unknown());
const positiveIntSchema = z.number().int().positive();
const promptStartSchema = z.object({ prompt: z.string() }).strict();
const segmentStartSchema = z
  .object({ turn: positiveIntSchema, segment: positiveIntSchema })
  .strict();
const probeSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  modelName: z.string().optional(),
});

const expectationSchema = z.object({
  description: z.string(),
  workspace: z.string().optional(),
  start: z.union([promptStartSchema, segmentStartSchema]),
  stop: z.object({ after: eventPatternSchema }).optional(),
  expect: z.array(eventPatternSchema).optional(),
  judge: z.string().optional(),
  probes: z.array(probeSchema).optional(),
});

type Expectation = z.infer<typeof expectationSchema>;

interface RunOptions {
  governorModel?: string;
  judgeModel?: string;
  isYes: boolean;
}

interface ExpectationResult {
  name: string;
  expectPassed: number;
  expectTotal: number;
  judgment?: Judgment;
}

function isMatch(event: TurnEvent, pattern: Record<string, unknown>): boolean {
  const fields: Record<string, unknown> = { ...event };
  return Object.entries(pattern).every(([key, value]) => fields[key] === value);
}

function failOnTurnError(turn: number, error: unknown): never {
  throw new Error(`turn ${turn}: ${String(error)}`, { cause: error });
}

function flagValue(cliArguments: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return cliArguments.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function listExpectations(runtime: Runtime, conversationDir: string): Promise<string[]> {
  const expectationsDir = path.join(conversationDir, "expectations");
  if (!(await runtime.fs.exists(expectationsDir))) {
    throw new Error(`${expectationsDir} does not exist`);
  }
  const entries = await runtime.fs.readDir(expectationsDir);
  const files = entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith(".yml"))
    .map((entry) => path.join(expectationsDir, entry.name))
    .toSorted((a, b) => a.localeCompare(b));
  if (files.length === 0) throw new Error(`${expectationsDir} has no .yml expectations`);
  return files;
}

async function loadSeed(runtime: Runtime, conversationDir: string, expectation: Expectation) {
  if ("prompt" in expectation.start) {
    const seed = await loadSessionTurns(runtime.fs, conversationDir, failOnTurnError);
    return { events: seed.events, turnIndex: nextTurnIndexAfter(seed.turnNumbers) };
  }
  const { turn, segment } = expectation.start;
  const turnDir = turnDirFor(conversationDir, turn);
  const segmentFiles = await listSegmentFiles(runtime.fs, turnDir);
  const startSegment = segmentFiles.find((file) => file.position === segment);
  if (!startSegment) throw new Error(`${turnDir} has no segment ${segment}`);
  if (!startSegment.name.endsWith(EXIT_SEGMENT_SUFFIX)) {
    throw new Error(
      `start at ${startSegment.name} is unsupported; only *${EXIT_SEGMENT_SUFFIX} segments can be resumed`
    );
  }
  const earlier = await loadSessionTurns(runtime.fs, conversationDir, failOnTurnError, turn - 1);
  const partial = await loadTurn(runtime.fs, turnDir, segment);
  return { events: [...earlier.events, ...partial], turnIndex: turn };
}

async function runExpectation(
  runtime: Runtime,
  conversationDir: string,
  expectationPath: string,
  options: RunOptions
): Promise<ExpectationResult> {
  const name = path.basename(expectationPath, ".yml");
  const expectation = expectationSchema.parse(
    YAML.parse(await runtime.fs.readText(expectationPath))
  );
  const workspaceDir = expectation.workspace
    ? path.resolve(conversationDir, expectation.workspace)
    : conversationDir;

  const seed = await loadSeed(runtime, conversationDir, expectation);
  const history = replayWorkerMessages(seed.events);

  const sessionId = `run-${name}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  const governor = new GovernorInterceptor({
    runtime,
    initialState: replayGovernorState(seed.events),
    modelName: options.governorModel,
  });
  const teacher = new ToolTeacherInterceptor({ runtime, modelName: options.governorModel });
  const ui = new UiInterceptor({ runtime, intents: governor, modelName: options.governorModel });
  const probes = (expectation.probes ?? []).map((probe) => new ExitProbeInterceptor(probe));
  const interceptors: AgentInterceptor[] = [...probes, teacher, governor, ui];
  const workerPrompt = await loadWorkerPrompt(runtime, workspaceDir);
  const runner = new AgentRunner({
    runtime,
    workspaceDir,
    sessionId,
    initialTurnIndex: seed.turnIndex,
    systemPrompt: workerPrompt.prompt,
    contextFiles: toContextFiles(workerPrompt.files),
    interceptors,
    loadHistory: async () => history,
  });

  console.log(bold(`▶ ${name}`));
  console.log(dim(`description   ${expectation.description.trim()}`));
  console.log(dim(`seed          ${seed.events.length} events, ${history.length} messages`));
  console.log(dim(`run dir       ${runner.getSessionDir()}`));
  if (expectation.stop) console.log(dim(`stop after    ${JSON.stringify(expectation.stop.after)}`));
  console.log();

  const controller = new AbortController();
  const stopAfter = expectation.stop?.after;
  const runEvents: TurnEvent[] = [];
  let isStopped = false;
  const isPromptStart = "prompt" in expectation.start;
  const answerPrompt = answerPromptsWith(runner, options.isYes);
  const onEvent = (event: TurnEvent) => {
    runEvents.push(event);
    const line = renderEvent(event);
    if (line !== null) console.log(line);
    if (isPromptStart) answerPrompt(event);
    if (isStopped || !stopAfter || !isMatch(event, stopAfter)) return;
    isStopped = true;
    controller.abort();
  };

  try {
    if ("prompt" in expectation.start) {
      await runner.run(expectation.start.prompt, sessionId, {
        signal: controller.signal,
        onEvent,
      });
    } else {
      await runExitOnly(
        interceptors,
        runner,
        history,
        seed.turnIndex,
        workspaceDir,
        onEvent,
        (prompt) => autoAnswer(prompt, options.isYes)
      );
    }
  } catch (error) {
    if (!isStopped) throw error;
  }

  console.log(cyan(isStopped ? "\n■ stopped by stop" : "\n■ turn completed"));
  console.log(renderAssumptions(governor.state));

  const patterns = expectation.expect ?? [];
  let expectPassed = 0;
  for (const pattern of patterns) {
    const isMet = runEvents.some((event) => isMatch(event, pattern));
    if (isMet) expectPassed++;
    console.log(
      isMet
        ? green(`  ✔ expect ${JSON.stringify(pattern)}`)
        : red(`  ✘ expect ${JSON.stringify(pattern)}`)
    );
  }

  const judgment = expectation.judge
    ? await judgeOplog(
        expectation.description,
        expectation.judge,
        [...seed.events, ...runEvents],
        options.judgeModel
      )
    : undefined;
  if (judgment)
    console.log(paintJudgment(judgment)(`  judge ${judgment.verdict}: ${judgment.reason}`));
  console.log();

  return { name, expectPassed, expectTotal: patterns.length, judgment };
}

function paintJudgment(judgment: Judgment) {
  if (judgment.verdict === "pass") return green;
  return judgment.verdict === "warn" ? yellow : red;
}

function isFailure(result: ExpectationResult, isStrict: boolean): boolean {
  const verdict = result.judgment?.verdict;
  return (
    result.expectPassed < result.expectTotal ||
    verdict === "fail" ||
    (isStrict && verdict === "warn")
  );
}

function renderSummaryLine(result: ExpectationResult, isStrict: boolean): string {
  const judgeText = result.judgment
    ? `judge ${result.judgment.verdict}  ${JSON.stringify(result.judgment.reason)}`
    : "judge -";
  const line = `${result.name}   expect ${result.expectPassed}/${result.expectTotal}   ${judgeText}`;
  if (isFailure(result, isStrict)) return red(`✘ ${line}`);
  return result.judgment?.verdict === "warn" ? yellow(`⚠ ${line}`) : green(`✔ ${line}`);
}

async function main() {
  const cliArguments = process.argv.slice(2);
  const flags = new Set(cliArguments.filter((argument) => argument.startsWith("--")));
  if (flags.has("--color")) setColor(true);
  if (flags.has("--no-color")) setColor(false);
  const isStrict = flags.has("--strict");
  const options: RunOptions = {
    isYes: isYesFlag(cliArguments),
    governorModel: flagValue(cliArguments, "governor-model"),
    judgeModel: flagValue(cliArguments, "judge-model"),
  };
  const target = cliArguments.find((argument) => !argument.startsWith("--"));
  if (!target) throw new Error(USAGE);

  const runtime = createNodeRuntime();
  const targetPath = path.resolve(target);
  const isSingle = targetPath.endsWith(".yml");
  const conversationDir = isSingle ? path.dirname(path.dirname(targetPath)) : targetPath;
  const expectationPaths = isSingle
    ? [targetPath]
    : await listExpectations(runtime, conversationDir);

  console.log(dim(`conversation  ${conversationDir}\n`));
  const results: ExpectationResult[] = [];
  for (const expectationPath of expectationPaths) {
    results.push(await runExpectation(runtime, conversationDir, expectationPath, options));
  }

  console.log(bold("■ summary"));
  for (const result of results) console.log(renderSummaryLine(result, isStrict));
  if (results.some((result) => isFailure(result, isStrict))) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
