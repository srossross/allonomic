import type { Runtime } from "../ports";
import type { GovernorState, UserIntent } from "./types";
import type { ToolCall } from "../graph/types";

export async function loadPromptFile(runtime: Runtime, filename: string): Promise<string> {
  try {
    const resourcePath = await runtime.paths.resource(`app-data/prompts/governor/${filename}`);
    return await runtime.fs.readText(resourcePath);
  } catch (error) {
    console.warn(`Failed to read prompt ${filename}:`, error);
    return "";
  }
}

function baseConstraintsSection(constraintsContent: string | null): string {
  return constraintsContent
    ? `\n## Base Project Constraints (from agents/CONSTRAINTS.md)\n${constraintsContent}\n`
    : "";
}

const FORK_PREAMBLE = `---
STOP. You are no longer the assistant above. Everything above is the worker agent's conversation, shown to you for review.
You are the Governor. Act ONLY through the Governor tools available to you now.
---`;

export function buildInterceptorInstructions(
  template: string,
  state: GovernorState,
  constraintsContent: string | null
): string {
  return `${FORK_PREAMBLE}

${template}

## Active Intent Stack
${JSON.stringify(state.intent_stack, null, 2)}

## Global Constraints
${JSON.stringify(state.global_constraints)}
${baseConstraintsSection(constraintsContent)}`;
}

export function describeToolCall(toolCall: ToolCall): string {
  return `${toolCall.id ?? "(no id)"} ${toolCall.name}(${JSON.stringify(toolCall.args)})`;
}

export function buildDenyMessage(
  intent: UserIntent | undefined,
  toolCall: ToolCall,
  reason: string
): string {
  const interpreted = intent ? `"${intent.description}" (${intent.kind})` : "(no active intent)";
  return `We have interpreted the user intent as ${interpreted} and tool call ${describeToolCall(toolCall)} does not look like it is heading in the direction of satisfying the intent. Reason: ${reason}`;
}

export function buildRejectionContext(
  state: GovernorState,
  constraintsContent: string | null
): string {
  return `\n\nActive Intents: ${JSON.stringify(state.intent_stack)}\nConstraints: ${JSON.stringify(state.global_constraints)}\n${constraintsContent ? `Base Constraints:\n${constraintsContent}` : ""}`;
}
