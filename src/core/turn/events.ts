import { z } from "zod";
import { governorActionSchema } from "../governor/types";
import { presentationSchema } from "../ui/presentation";

const argsSchema = z.record(z.unknown());
const settingsChangesSchema = z.record(z.unknown());

const toolCallRequestSchema = z.object({
  id: z.string(),
  providerId: z.string().optional(),
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
const promptAnswerSchema = z.union([z.boolean(), z.string()]);
const promptValueSchema = z.union([promptAnswerSchema, z.record(promptAnswerSchema)]);
const assumptionQuestionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  label: z.string(),
  options: stringListSchema,
});

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
  z.object({
    kind: z.literal("assumptions"),
    label: z.string(),
    questions: z.array(assumptionQuestionSchema),
  }),
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

const contextFileAgentSchema = z.enum(["worker", "governor", "teacher", "ui"]);
const contextFileHookSchema = z.enum([
  "session",
  "userPrompt",
  "preTool",
  "postTool",
  "finish",
  "present",
]);

const contextFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  missing: z.boolean(),
  loadedAt: z.string(),
  sha256: z.string().optional(),
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
    type: z.literal("model_usage"),
    agent: z.string().optional(),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
    status: z.enum(["success", "error"]).optional(),
  }),
  z.object({
    type: z.literal("tool_output_stored"),
    toolCallId: z.string(),
    path: z.string(),
    chars: z.number(),
    lines: z.number(),
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
    intentId: z.string().optional(),
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
    phase: z.enum(["entry", "pre_tool", "post_tool", "exit", "present"]).optional(),
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
    type: z.literal("interceptor_passed"),
    interceptor: z.string(),
    phase: z.string(),
    toolCallId: z.string().optional(),
    durationMs: z.number(),
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
  z.object({
    type: z.literal("presentation"),
    interceptor: z.string(),
    presentation: presentationSchema,
  }),
  z.object({ type: z.literal("settings_changed"), changes: settingsChangesSchema }),
  z.object({ type: z.literal("exit_retry"), feedback: z.string() }),
  z.object({ type: z.literal("paused") }),
  z.object({ type: z.literal("resumed") }),
  z.object({ type: z.literal("prompt_delivered"), queueId: z.string(), text: z.string() }),
  z.object({ type: z.literal("warning"), source: z.string(), message: z.string() }),
  z.object({ type: z.literal("rewound"), head: z.number().nullable() }),
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
  actor: z.string(),
});

export const turnEventSchema = turnEventMetaSchema.and(turnEventBodySchema);

export type TurnEventBody = z.infer<typeof turnEventBodySchema>;
export type TurnEvent = z.infer<typeof turnEventSchema>;
export type TurnEventOf<T extends TurnEvent["type"]> = Extract<TurnEvent, { type: T }>;

export const WORKER_ACTOR = "worker";
export const USER_ACTOR = "user";

const OP_EVENT_TYPES = new Set<TurnEvent["type"]>([
  "turn_started",
  "prompt_delivered",
  "model_step",
  "tool_result",
  "governor_brief",
  "exit_retry",
  "governor_action",
  "turn_completed",
  "turn_failed",
  "rewound",
]);

export function isOpEvent(event: TurnEvent): boolean {
  return OP_EVENT_TYPES.has(event.type);
}

export interface ScopeOptions {
  phase?: string;
  toolCallId?: string;
}

export interface TurnEventSink {
  emit(event: TurnEventBody): void;
  scope(name: string, options?: ScopeOptions): ScopedSink;
}

export interface ScopedSink extends TurnEventSink {
  close(options?: { collapse?: boolean }): void;
}

export interface TurnSegment {
  actor: string;
  isScope: boolean;
  events: TurnEvent[];
}

export type TurnEventListener = (event: TurnEvent) => void;

/**
For failures that happen before a turn exists (e.g. runner setup), so they fold like any other event.
*/
export function createDetachedTurnEvent(body: TurnEventBody): TurnEvent {
  return {
    ...body,
    seq: Date.now(),
    turnIndex: 0,
    actor: WORKER_ACTOR,
    at: new Date().toISOString(),
  };
}
