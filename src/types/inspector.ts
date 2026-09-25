export type ConsoleBadgeVariant =
  "sky" | "purple" | "amber" | "emerald" | "destructive" | "neutral";

export interface ConsoleEvent {
  id: string;
  timestamp: string;
  type: string;
  badge: string;
  badgeVariant: ConsoleBadgeVariant;
  summary: string;
  details?: unknown;
}

export type InspectorTab = "intents" | "constraints" | "tools" | "injectors" | "console";

export interface InjectorPhase {
  name: string;
  hook: string;
  description: string;
}

export interface InjectorMeta {
  id: string;
  name: string;
  type: string;
  status: "active" | "inactive";
  modelName: string;
  description: string;
  phases: InjectorPhase[];
  constraintsPath?: string;
}

import { DEFAULT_MODEL_ID } from "./chat";

export const DEFAULT_INJECTORS: InjectorMeta[] = [
  {
    id: "governor",
    name: "Governor",
    type: "Pipeline Interceptor",
    status: "active",
    modelName: DEFAULT_MODEL_ID,
    description:
      "Monitors and intercepts agent actions across execution phases to enforce policy, constraints, and goal satisfaction verification.",
    phases: [
      {
        name: "Entry Intercept",
        hook: "onUserPrompt",
        description: "Extracts intent stack and loads constraints from agents/CONSTRAINTS.md",
      },
      {
        name: "Pre-Tool Intercept",
        hook: "onPreToolCall",
        description: "Authorizes or blocks tool calls against policy rules before execution",
      },
      {
        name: "Exit Intercept",
        hook: "onAgentExit",
        description: "Verifies intent completion and triggers automatic retries if unsatisfied",
      },
    ],
    constraintsPath: "agents/CONSTRAINTS.md",
  },
];
