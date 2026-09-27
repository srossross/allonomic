import { z } from "zod";
import { TOOL_SPECS, type ToolCategory, type ToolSpec } from "@/core/tools/specs";

export type ToolCallStatus =
  "pending" | "approved" | "rejected" | "executed" | "running" | "blocked";

export type UserPrompt =
  | { kind: "confirm"; label: string; detail?: string }
  | { kind: "choice"; label: string; options: Array<{ value: string; label: string }> }
  | { kind: "text"; label: string; placeholder?: string };

export type UserPromptValue = boolean | string;

export interface ToolCallInfo {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: ToolCallStatus;
  prompt?: UserPrompt;
  reason?: string;
}

export interface AgentToolMeta {
  name: string;
  category: ToolCategory;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }>;
}

function baseTypeName(field: z.ZodTypeAny): string {
  let current = field;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current._def.innerType;
  }
  return String(current._def.typeName).replace(/^Zod/, "").toLowerCase();
}

function toMeta({ name, category, description, schema }: ToolSpec): AgentToolMeta {
  return {
    name,
    category,
    description,
    parameters: Object.entries<z.ZodTypeAny>(schema.shape).map(([parameterName, field]) => ({
      name: parameterName,
      type: baseTypeName(field),
      required: !field.isOptional(),
      description: field.description ?? "",
    })),
  };
}

export const AVAILABLE_TOOLS: AgentToolMeta[] = Object.values(TOOL_SPECS).map((spec) =>
  toMeta(spec)
);

export function toolCategory(name: string): ToolCategory | undefined {
  return AVAILABLE_TOOLS.find((t) => t.name === name)?.category;
}
