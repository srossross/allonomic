import YAML from "yaml";
import { z } from "zod";
import type { FileStore } from "../ports";
import { join } from "../paths";
import { governorActionFromCall } from "../governor/reducer";
import { messageText } from "../graph/thinking";
import type { TurnEvent, TurnEventBody } from "./events";

const argsSchema = z.record(z.unknown());
const callSchema = z.object({ name: z.string(), args: argsSchema.nullish() });
const callsFileSchema = z.object({
  tool_calls: z.array(callSchema).nullish(),
  timestamp: z.string().nullish(),
});
const preToolSchema = z.object({
  tool: z.string(),
  args: argsSchema.nullish(),
  approved: z.boolean().nullish(),
  reason: z.string().nullish(),
});
const messageToolCallSchema = z.object({
  id: z.string().nullish(),
  name: z.string(),
  args: argsSchema.nullish(),
});
const messageSchema = z.object({
  type: z.string().nullish(),
  role: z.string().nullish(),
  name: z.string().nullish(),
  content: z.unknown(),
  thinking: z.string().nullish(),
  tool_calls: z.array(messageToolCallSchema).nullish(),
  tool_call_id: z.string().nullish(),
});
const agentFileSchema = z.object({
  final_response: z.string().nullish(),
  messages: z.array(messageSchema).nullish(),
  timestamp: z.string().nullish(),
});
const userFileSchema = z.object({ prompt: z.string().nullish(), timestamp: z.string().nullish() });
const errorFileSchema = z.object({
  error: z.string(),
  stack: z.string().nullish(),
  timestamp: z.string().nullish(),
  entryToolCalls: z.array(callSchema).nullish(),
  preToolLogs: z.array(preToolSchema).nullish(),
  exitToolCalls: z.array(callSchema).nullish(),
});

type LegacyCall = z.infer<typeof callSchema>;
type LegacyPreTool = z.infer<typeof preToolSchema>;
type LegacyMessage = z.infer<typeof messageSchema>;

const RETRY_PREFIX = "Your output did not satisfy";
const GOVERNOR = "Governor";

async function readYaml<T>(
  fs: FileStore,
  path: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  return (await fs.exists(path)) ? schema.parse(YAML.parse(await fs.readText(path))) : undefined;
}

function governorCallEvent(call: LegacyCall, phase: "entry" | "exit"): TurnEventBody | null {
  const args = call.args ?? {};
  if (call.name === "finish") {
    return phase === "entry"
      ? {
          type: "governor_verdict",
          phase,
          interceptor: GOVERNOR,
          approved: true,
          reasoning: typeof args.reasoning === "string" ? args.reasoning : undefined,
        }
      : {
          type: "governor_verdict",
          phase,
          interceptor: GOVERNOR,
          approved: args.approved !== false,
          feedback: typeof args.feedback === "string" ? args.feedback : undefined,
          nextStep: typeof args.nextStep === "string" ? args.nextStep : undefined,
        };
  }
  if (phase === "exit" && (call.name === "read_file" || call.name === "list_files")) {
    return { type: "governor_inspect", interceptor: GOVERNOR, tool: call.name, args };
  }
  const action = governorActionFromCall(call.name, args);
  return action ? { type: "governor_action", phase, interceptor: GOVERNOR, action } : null;
}

function turnScopedMessages(
  messages: LegacyMessage[],
  prompt: string,
  previousCount: number
): LegacyMessage[] {
  if (prompt) {
    const index = messages.findLastIndex(
      (m) => m.type === "human" && messageText(m.content) === prompt
    );
    if (index !== -1) return messages.slice(index + 1);
  }
  return messages.slice(Math.min(previousCount, messages.length));
}

function messageEvents(
  messages: LegacyMessage[],
  turnIndex: number,
  preTools: LegacyPreTool[]
): TurnEventBody[] {
  const bodies: TurnEventBody[] = [];
  const openCalls: Array<{ id: string; name: string }> = [];
  const pendingPreTools = [...preTools];

  for (const [index, m] of messages.entries()) {
    const type = m.type ?? m.role;
    if (type === "ai" || type === "assistant") {
      const toolCalls = (m.tool_calls ?? []).map((tc, callIndex) => ({
        id: tc.id ?? `legacy-${turnIndex}-${index}-${callIndex}`,
        name: tc.name,
        args: tc.args ?? {},
      }));
      openCalls.push(...toolCalls);
      bodies.push({
        type: "model_step",
        stepId: `legacy-${turnIndex}-${index}`,
        content: messageText(m.content),
        thinking: m.thinking ?? undefined,
        toolCalls,
        durationMs: 0,
      });
    } else if (type === "tool") {
      const name = m.name ?? "tool";
      const callIndex = openCalls.findIndex((c) =>
        m.tool_call_id ? c.id === m.tool_call_id : c.name === name
      );
      const [call] = callIndex === -1 ? [] : openCalls.splice(callIndex, 1);
      const preIndex = pendingPreTools.findIndex((p) => p.tool === name);
      const [pre] = preIndex === -1 ? [] : pendingPreTools.splice(preIndex, 1);
      if (pre) {
        bodies.push({
          type: "governor_tool_decision",
          interceptor: GOVERNOR,
          tool: pre.tool,
          args: pre.args ?? {},
          approved: pre.approved !== false,
          reason: pre.reason ?? undefined,
        });
      }
      bodies.push({
        type: "tool_result",
        toolCallId: m.tool_call_id ?? call?.id ?? `legacy-${turnIndex}-${index}`,
        name,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    } else if (type === "human" && messageText(m.content).startsWith(RETRY_PREFIX)) {
      bodies.push({ type: "exit_retry", feedback: messageText(m.content) });
    }
  }
  return bodies;
}

export interface LoadedTurn {
  events: TurnEvent[];
  messageCount: number;
}

export async function loadLegacyTurn(
  fs: FileStore,
  turnDir: string,
  turnIndex: number,
  previousMessageCount: number
): Promise<LoadedTurn> {
  const interceptorsDir = join(turnDir, "interceptors");
  const user = await readYaml(fs, join(turnDir, "user.yml"), userFileSchema);
  const agent = await readYaml(fs, join(turnDir, "agent.yml"), agentFileSchema);
  const failure = await readYaml(fs, join(turnDir, "error.yml"), errorFileSchema);
  const entry = await readYaml(fs, join(interceptorsDir, "entry.yml"), callsFileSchema);
  const exit = await readYaml(fs, join(interceptorsDir, "exit.yml"), callsFileSchema);
  const preTools = await readYaml(
    fs,
    join(interceptorsDir, "pre_tools.yml"),
    z.array(preToolSchema)
  );

  const prompt = user?.prompt ?? "";
  const allMessages = agent?.messages ?? [];
  const bodies: TurnEventBody[] = [{ type: "turn_started", threadId: "", prompt: prompt || null }];

  const entryCalls = entry?.tool_calls ?? failure?.entryToolCalls ?? [];
  const exitCalls = exit?.tool_calls ?? failure?.exitToolCalls ?? [];
  for (const call of entryCalls) {
    const body = governorCallEvent(call, "entry");
    if (body) bodies.push(body);
  }
  bodies.push(
    ...messageEvents(
      turnScopedMessages(allMessages, prompt, previousMessageCount),
      turnIndex,
      preTools ?? failure?.preToolLogs ?? []
    )
  );
  for (const call of exitCalls) {
    const body = governorCallEvent(call, "exit");
    if (body) bodies.push(body);
  }

  if (failure) {
    bodies.push({
      type: "turn_failed",
      error: failure.error,
      stack: failure.stack ?? undefined,
      aborted: failure.error.includes("stopped by user"),
    });
  } else {
    bodies.push({
      type: "turn_completed",
      retries: bodies.filter((b) => b.type === "exit_retry").length,
      finalResponse: agent?.final_response ?? "",
    });
  }

  const at = user?.timestamp ?? agent?.timestamp ?? failure?.timestamp ?? new Date(0).toISOString();
  return {
    events: bodies.map((body, seq) => ({ ...body, seq, at, turnIndex })),
    messageCount: allMessages.length,
  };
}
