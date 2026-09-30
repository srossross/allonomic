import { z } from "zod";
import { governorActionSchema } from "../governor/types";

const argsSchema = z.record(z.unknown());

const toolCallRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: argsSchema,
  thoughtSignature: z.string().optional(),
});

type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export type RecoverableCall = ToolCallRequest & { decidedBy: string[] };

const phaseSchema = z.enum(["entry", "exit"]);

const optionalString = z.string().optional();
const stringListSchema = z.array(z.string());
const choiceOptionSchema = z.object({ value: z.string(), label: z.string() });
const promptValueSchema = z.union([z.boolean(), z.string()]);

const modeSchema = z.enum(["restricted", "read", "write", "god"]).optional();

const userPromptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confirm"),
    label: z.string(),
    detail: optionalString,
    mode: modeSchema,
    currentMode: modeSchema,
  }),
  z.object({
    kind: z.literal("choice"),
    label: z.string(),
    detail: optionalString,
    mode: modeSchema,
    options: z.array(choiceOptionSchema),
  }),
  z.object({ kind: z.literal("text"), label: z.string(), placeholder: optionalString }),
]);

const governorForkMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("ai"),
    content: z.string(),
    thinking: z.string().optional(),
    toolCalls: z.array(toolCallRequestSchema),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
  }),
]);

export type GovernorForkMessage = z.infer<typeof governorForkMessageSchema>;

const contextFileAgentSchema = z.enum(["worker", "governor", "teacher"]);
const contextFileHookSchema = z.enum(["session", "userPrompt", "preTool", "postTool", "finish"]);

const contextFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  missing: z.boolean(),
  loadedAt: z.string(),
});

export type ContextFileAgent = z.infer<typeof contextFileAgentSchema>;
export type ContextFileHook = z.infer<typeof contextFileHookSchema>;
export type ContextFile = z.infer<typeof contextFileSchema>;

const turnEventBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn_started"),
    threadId: z.string(),
    prompt: z.string().nullable(),
  }),
  z.object({
    type: z.literal("model_step"),
    stepId: z.string(),
    content: z.string(),
    thinking: z.string().optional(),
    toolCalls: z.array(toolCallRequestSchema),
    durationMs: z.number(),
    inputTokens: z.number().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
    status: z.enum(["success", "error"]).optional(),
  }),
  z.object({
    type: z.literal("prompt_requested"),
    promptId: z.string(),
    toolCallId: z.string().optional(),
    prompt: userPromptSchema,
  }),
  z.object({
    type: z.literal("prompt_answered"),
    promptId: z.string(),
    value: promptValueSchema,
  }),
  z.object({
    type: z.literal("governor_action"),
    phase: phaseSchema,
    interceptor: z.string(),
    action: governorActionSchema,
  }),
  z.object({
    type: z.literal("governor_verdict"),
    phase: phaseSchema,
    interceptor: z.string(),
    approved: z.boolean(),
    feedback: z.string().optional(),
    nextStep: z.string().optional(),
    reasoning: z.string().optional(),
  }),
  z.object({
    type: z.literal("governor_brief"),
    interceptor: z.string(),
    text: z.string(),
    doneWhen: stringListSchema,
  }),
  z.object({
    type: z.literal("governor_fork"),
    interceptor: z.string(),
    phase: z.enum(["entry", "pre_tool", "post_tool", "exit"]).optional(),
    pass: z.string(),
    messages: z.array(governorForkMessageSchema),
  }),
  z.object({
    type: z.literal("waiting"),
    on: z.string(),
    source: z.string().optional(),
    hook: z.string().optional(),
  }),
  z.object({
    type: z.literal("governor_inspect"),
    interceptor: z.string(),
    tool: z.string(),
    args: argsSchema,
  }),
  z.object({
    type: z.literal("governor_tool_decision"),
    interceptor: z.string(),
    tool: z.string(),
    toolCallId: z.string().optional(),
    args: argsSchema,
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("context_files_loaded"),
    agent: contextFileAgentSchema,
    hook: contextFileHookSchema,
    files: z.array(contextFileSchema),
  }),
  z.object({ type: z.literal("exit_retry"), feedback: z.string() }),
  z.object({ type: z.literal("paused") }),
  z.object({ type: z.literal("resumed") }),
  z.object({ type: z.literal("prompt_delivered"), queueId: z.string(), text: z.string() }),
  z.object({ type: z.literal("warning"), source: z.string(), message: z.string() }),
  z.object({ type: z.literal("turn_completed"), retries: z.number(), finalResponse: z.string() }),
  z.object({
    type: z.literal("turn_failed"),
    error: z.string(),
    stack: z.string().optional(),
    aborted: z.boolean(),
  }),
]);

const turnEventMetaSchema = z.object({
  seq: z.number(),
  at: z.string(),
  turnIndex: z.number(),
});

export const turnEventSchema = turnEventMetaSchema.and(turnEventBodySchema);

export const TURN_EVENTS_FILE = "events.yml";

export const turnEventFileSchema = z.object({
  version: z.literal(1),
  events: z.array(turnEventSchema),
});

export type TurnEventBody = z.infer<typeof turnEventBodySchema>;
export type TurnEvent = z.infer<typeof turnEventSchema>;
export type TurnEventOf<T extends TurnEvent["type"]> = Extract<TurnEvent, { type: T }>;

export interface TurnEventSink {
  emit(event: TurnEventBody): void;
}

export type TurnEventListener = (event: TurnEvent) => void;

/**
For failures that happen before a turn exists (e.g. runner setup), so they fold like any other event.
*/
export function createDetachedTurnEvent(body: TurnEventBody): TurnEvent {
  return { ...body, seq: Date.now(), turnIndex: 0, at: new Date().toISOString() };
}
