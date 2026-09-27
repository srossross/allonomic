import { z } from "zod";
import { governorActionSchema } from "../governor/types";

const argsSchema = z.record(z.unknown());

export const toolCallRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: argsSchema,
});

export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

const phaseSchema = z.enum(["entry", "exit"]);

export const turnEventBodySchema = z.discriminatedUnion("type", [
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
  }),
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
    status: z.enum(["success", "error"]).optional(),
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
  z.object({ type: z.literal("exit_retry"), feedback: z.string() }),
  z.object({ type: z.literal("turn_completed"), retries: z.number(), finalResponse: z.string() }),
  z.object({
    type: z.literal("turn_failed"),
    error: z.string(),
    stack: z.string().optional(),
    aborted: z.boolean(),
  }),
]);

export const turnEventMetaSchema = z.object({
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
