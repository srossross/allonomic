import * as fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { GovernorState, UserIntent, type IntentKind } from "../interceptor-agents/governor/types";

export interface ResumeResult {
  sessionId: string;
  sessionDir: string;
  governorState: GovernorState;
  messages: BaseMessage[];
  nextTurnIndex: number;
}

const VALID_INTENT_KINDS = new Set<string>([
  "request",
  "question",
  "feedback",
  "confirmation",
  "other",
  "unknown",
]);

function isIntentKind(value: unknown): value is IntentKind {
  return typeof value === "string" && VALID_INTENT_KINDS.has(value);
}

export function applyEntryToolCall(
  state: GovernorState,
  tc: { name: string; args?: Record<string, unknown> }
) {
  const args = tc.args || {};
  switch (tc.name) {
    case "push_intent": {
      const id =
        typeof args.id === "string"
          ? args.id
          : `intent_${state.intent_stack.length + state.completed_intents.length + 1}`;
      const kind: IntentKind = isIntentKind(args.kind) ? args.kind : "other";
      const description = typeof args.description === "string" ? args.description : "";
      const constraints = Array.isArray(args.constraints) ? args.constraints.map(String) : [];
      const newIntent: UserIntent = {
        id,
        kind,
        description,
        constraints,
      };
      state.intent_stack.push(newIntent);
      break;
    }
    case "add_constraint": {
      const target = typeof args.target === "string" ? args.target : "global";
      const constraint = typeof args.constraint === "string" ? args.constraint : "";
      if (target === "global") {
        state.global_constraints.push(constraint);
      } else {
        const intent = state.intent_stack.find((item) => item.id === target);
        if (intent) {
          intent.constraints.push(constraint);
        }
      }
      break;
    }
    case "remove_constraint": {
      const target = typeof args.target === "string" ? args.target : "global";
      const constraint = typeof args.constraint === "string" ? args.constraint : "";
      if (target === "global") {
        state.global_constraints = state.global_constraints.filter((c) => c !== constraint);
      } else {
        const intent = state.intent_stack.find((item) => item.id === target);
        if (intent) {
          intent.constraints = intent.constraints.filter((c) => c !== constraint);
        }
      }
      break;
    }
    case "pop_intent": {
      if (typeof args.id === "string") {
        const index = state.intent_stack.findIndex((item) => item.id === args.id);
        if (index !== -1) state.intent_stack.splice(index, 1);
      } else if (state.intent_stack.length > 0) {
        state.intent_stack.pop();
      }
      break;
    }
  }
}

/**
 * Replays turns from sourceDir up to upToTurn, rebuilding GovernorState
 * deterministically using pure event sourcing (zero LLM calls).
 * If newDir is provided, forks the turns into the new directory.
 */
export async function resumeFromDir(
  sourceDir: string,
  newDir?: string,
  upToTurn?: number
): Promise<ResumeResult> {
  const turnsRootDir = path.resolve(sourceDir, "turns");

  let turnEntries: string[];
  try {
    const entries = await fs.readdir(turnsRootDir, { withFileTypes: true });
    turnEntries = entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .toSorted((a, b) => Number(a) - Number(b));
  } catch (error_: unknown) {
    const message = error_ instanceof Error ? error_.message : String(error_);
    throw new Error(`Failed to read turns from ${turnsRootDir}: ${message}`, {
      cause: error_,
    });
  }

  const turnsToReplay = upToTurn ? turnEntries.filter((t) => Number(t) <= upToTurn) : turnEntries;

  // Replay GovernorState
  const state: GovernorState = {
    intent_stack: [],
    completed_intents: [],
    global_constraints: [],
  };

  const messages: BaseMessage[] = [];

  for (const turnName of turnsToReplay) {
    const currentTurnDir = path.join(turnsRootDir, turnName);
    const interceptorsDir = path.join(currentTurnDir, "interceptors");

    // 1. Replay Entry Interceptor (push_intent, add_constraint, etc.)
    try {
      const entryRaw = await fs.readFile(path.join(interceptorsDir, "entry.yml"), "utf8");
      const entryData = YAML.parse(entryRaw);
      if (entryData?.tool_calls && Array.isArray(entryData.tool_calls)) {
        for (const tc of entryData.tool_calls) {
          applyEntryToolCall(state, tc);
        }
      }
    } catch {
      // No entry.yml for this turn, continue
    }

    // 2. Replay Exit Interceptor (resolve_intent)
    try {
      const exitRaw = await fs.readFile(path.join(interceptorsDir, "exit.yml"), "utf8");
      const exitData = YAML.parse(exitRaw);
      if (exitData?.tool_calls && Array.isArray(exitData.tool_calls)) {
        for (const tc of exitData.tool_calls) {
          if (tc.name !== "resolve_intent") continue;

          const index = state.intent_stack.findIndex((item) => item.id === tc.args?.id);
          if (index === -1) continue;

          const [resolved] = state.intent_stack.splice(index, 1);
          state.completed_intents.push(resolved);
        }
      }
    } catch {
      // No exit.yml for this turn, continue
    }

    // 3. Load Chat History
    try {
      const userRaw = await fs.readFile(path.join(currentTurnDir, "user.yml"), "utf8");
      const userData = YAML.parse(userRaw);
      if (userData?.prompt) {
        messages.push(new HumanMessage(userData.prompt));
      }

      const agentRaw = await fs.readFile(path.join(currentTurnDir, "agent.yml"), "utf8");
      const agentData = YAML.parse(agentRaw);
      if (agentData?.final_response) {
        messages.push(new AIMessage(agentData.final_response));
      }
    } catch {
      // Continue if user or agent file missing
    }
  }

  // Fork / copy turns if newDir specified
  let targetSessionDir = sourceDir;
  let targetSessionId = path.basename(sourceDir);

  if (newDir) {
    targetSessionDir = newDir;
    targetSessionId = path.basename(newDir);
    const targetTurnsRoot = path.resolve(newDir, "turns");
    await fs.mkdir(targetTurnsRoot, { recursive: true });

    for (const turnName of turnsToReplay) {
      const sourceTurnPath = path.join(turnsRootDir, turnName);
      const dstTurnPath = path.join(targetTurnsRoot, turnName);
      await fs.cp(sourceTurnPath, dstTurnPath, { recursive: true });
    }
  }

  const nextTurnIndex = turnsToReplay.length + 1;

  return {
    sessionId: targetSessionId,
    sessionDir: targetSessionDir,
    governorState: state,
    messages,
    nextTurnIndex,
  };
}
