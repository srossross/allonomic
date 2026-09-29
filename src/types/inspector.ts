import type { ContextFileAgent, ContextFileHook } from "@/core/turn/events";

export interface AgentFileRow {
  agent: ContextFileAgent;
  path: string;
  size: number;
  hooks: ContextFileHook[];
  lastLoadedAt: string;
  missing: boolean;
}

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
