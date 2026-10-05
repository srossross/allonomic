import type { Runtime } from "../ports";
import type { GovernorState, UserIntent } from "./types";
import { readContextFile, type LoadedFile } from "../contextFiles";

export async function loadPromptFile(
  runtime: Runtime,
  filename: string,
  directory = "governor"
): Promise<LoadedFile> {
  const path = await runtime.paths.resource(`app-data/prompts/${directory}/${filename}`);
  return readContextFile(runtime, path);
}

export interface PromptSection {
  title: string;
  body: string;
}

export function buildInterceptorInstructions(
  preamble: string,
  template: string,
  intentStack: UserIntent[],
  sections: PromptSection[]
): string {
  return `${preamble.trim()}

${template}

## Active Intent Stack
${JSON.stringify(intentStack, null, 2)}
${sections.map(({ title, body }) => `\n## ${title}\n${body}\n`).join("")}`;
}

export interface IntentBriefChanges {
  added: UserIntent[];
  changed: UserIntent[];
  dropped: UserIntent[];
}

function intentBlock(intent: UserIntent, isChanged: boolean): string {
  return [
    `Goal: ${intent.description}`,
    isChanged && intent.changelog.length > 0 && `Changed: ${intent.changelog.at(-1)}`,
    intent.completed_when && `Done when: ${intent.completed_when}`,
    intent.overstep && `You would be overstepping the users intent if you: ${intent.overstep}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildIntentBrief({
  added,
  changed,
  dropped,
}: IntentBriefChanges): string | undefined {
  const blocks = [
    ...added.map((intent) => intentBlock(intent, false)),
    ...changed.map((intent) => intentBlock(intent, true)),
    ...dropped.map((intent) => `No longer needed: ${intent.description}`),
  ];
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

export function assumptionSection(state: GovernorState): PromptSection {
  return {
    title: "Assumptions",
    body: state.assumptions.length === 0 ? "(none)" : JSON.stringify(state.assumptions, null, 2),
  };
}
