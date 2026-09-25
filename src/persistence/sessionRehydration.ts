/**
 * @ai-instruction DO NOT replace this system with an opaque database (like SqliteSaver). 
 * We deliberately use an Event-Sourced YAML architecture so that all agent thoughts, 
 * tool calls, and state transitions remain human-readable, auditable, and manually editable on disk.
 */
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Message, ContextMessage, ConsoleEvent } from "../types";
import { DEFAULT_MODEL_ID } from "../types/chat";
import type { GovernorState } from "../interceptor-agents/governor/types";
import type { RehydratedSession } from "../types/persistence";
import { loadSessionMetadata, saveSessionMetadata } from "./sessionMetadata";
import { buildTurnEvents } from "../agent/turnEvents";
import { applyEntryToolCall } from "../telemetry/sessionReplay";

export async function rehydrateSession(
  workspaceDir: string,
  sessionId: string
): Promise<RehydratedSession> {
  const sessionDir = path.resolve(workspaceDir, ".atomic/sessions", sessionId);
  const turnsRootDir = path.join(sessionDir, "turns");

  let metadata = await loadSessionMetadata(workspaceDir, sessionId);
  if (!metadata) {
    metadata = {
      sessionId,
      title: sessionId,
      closed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: DEFAULT_MODEL_ID,
      thinkingLevel: "Low",
      enabledTools: ["read_file", "write_file", "list_files", "run_command"],
    };
    await saveSessionMetadata(workspaceDir, metadata);
  }

  const governorState: GovernorState = {
    intent_stack: [],
    completed_intents: [],
    global_constraints: [],
  };

  const messages: Message[] = [];
  const contextMessages: ContextMessage[] = [];
  const allConsoleEvents: ConsoleEvent[] = [];

  let turnEntries: string[] = [];
  try {
    const entries = await fs.readdir(turnsRootDir, { withFileTypes: true });
    turnEntries = entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .toSorted((a, b) => Number(a) - Number(b));
  } catch {
    // No turns folder yet
  }

  for (const turnName of turnEntries) {
    const turnIndex = Number(turnName);
    const currentTurnDir = path.join(turnsRootDir, turnName);
    const interceptorsDir = path.join(currentTurnDir, "interceptors");

    let userPrompt = "";
    try {
      const userRaw = await fs.readFile(path.join(currentTurnDir, "user.yml"), "utf8");
      const userData: unknown = YAML.parse(userRaw);
      if (userData && typeof userData === "object") {
        const promptRaw = Reflect.get(userData, "prompt");
        if (typeof promptRaw === "string") {
          userPrompt = promptRaw;
          messages.push({
            id: `user-${turnName}`,
            role: "user",
            content: userPrompt,
          });
        }
      }
    } catch {
      // Ignore missing user.yml
    }

    // 1. Entry Interceptors
    const entryToolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    try {
      const entryRaw = await fs.readFile(path.join(interceptorsDir, "entry.yml"), "utf8");
      const entryData: unknown = YAML.parse(entryRaw);
      if (entryData && typeof entryData === "object") {
        const callsRaw = Reflect.get(entryData, "tool_calls");
        if (Array.isArray(callsRaw)) {
          for (const call of callsRaw) {
            if (!call || typeof call !== "object") continue;
            const name = Reflect.get(call, "name");
            if (typeof name !== "string") continue;
            const args = Reflect.get(call, "args");
            const tc = {
              name,
              args: args && typeof args === "object" ? args : undefined,
            };
            entryToolCalls.push(tc);
            applyEntryToolCall(governorState, tc);
          }
        }
      }
    } catch {
      // Ignore missing entry.yml
    }

    // 2. Pre-tool logs
    const preToolLogs: Array<{ tool: string; approved: boolean; reason?: string }> = [];
    try {
      const preRaw = await fs.readFile(path.join(interceptorsDir, "pre_tools.yml"), "utf8");
      const preData: unknown = YAML.parse(preRaw);
      if (Array.isArray(preData)) {
        for (const log of preData) {
          if (!log || typeof log !== "object") continue;
          const tool = Reflect.get(log, "tool");
          const approved = Reflect.get(log, "approved");
          const reason = Reflect.get(log, "reason");
          if (typeof tool === "string") {
            preToolLogs.push({
              tool,
              approved: Boolean(approved),
              reason: typeof reason === "string" ? reason : undefined,
            });
          }
        }
      }
    } catch {
      // Ignore missing pre_tools.yml
    }

    // 3. Exit Interceptors
    const exitToolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    try {
      const exitRaw = await fs.readFile(path.join(interceptorsDir, "exit.yml"), "utf8");
      const exitData: unknown = YAML.parse(exitRaw);
      if (exitData && typeof exitData === "object") {
        const callsRaw = Reflect.get(exitData, "tool_calls");
        if (Array.isArray(callsRaw)) {
          for (const call of callsRaw) {
            if (!call || typeof call !== "object") continue;
            const name = Reflect.get(call, "name");
            if (typeof name !== "string") continue;
            const args = Reflect.get(call, "args");
            const tc = {
              name,
              args: args && typeof args === "object" ? args : undefined,
            };
            exitToolCalls.push(tc);

            if (tc.name !== "resolve_intent") continue;
            const idRaw = tc.args ? Reflect.get(tc.args, "id") : undefined;
            if (typeof idRaw !== "string") continue;
            const index = governorState.intent_stack.findIndex((item) => item.id === idRaw);
            if (index === -1) continue;
            const [resolved] = governorState.intent_stack.splice(index, 1);
            governorState.completed_intents.push(resolved);
          }
        }
      }
    } catch {
      // Ignore missing exit.yml
    }

    // 4. Agent Response & Messages
    let thinking: string | undefined;
    interface AgentYamlMessage {
      type?: string;
      role?: string;
      content?: unknown;
      thinking?: string;
      tool_calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
    }
    const rawMessages: AgentYamlMessage[] = [];

    try {
      const agentRaw = await fs.readFile(path.join(currentTurnDir, "agent.yml"), "utf8");
      const agentData: unknown = YAML.parse(agentRaw);

      if (agentData && typeof agentData === "object") {
        const finalResponseRaw = Reflect.get(agentData, "final_response");
        const finalResponse = typeof finalResponseRaw === "string" ? finalResponseRaw : "";
        const thinkingRaw = Reflect.get(agentData, "thinking");
        thinking = typeof thinkingRaw === "string" ? thinkingRaw : undefined;

        const messagesRaw = Reflect.get(agentData, "messages");
        if (Array.isArray(messagesRaw)) {
          for (const m of messagesRaw) {
            if (!m || typeof m !== "object") continue;
            const type = Reflect.get(m, "type");
            const role = Reflect.get(m, "role");
            const content = Reflect.get(m, "content");
            const mThinking = Reflect.get(m, "thinking");
            const mToolCalls = Reflect.get(m, "tool_calls");

            const msgObj: AgentYamlMessage = {
              type: typeof type === "string" ? type : undefined,
              role: typeof role === "string" ? role : undefined,
              content,
              thinking: typeof mThinking === "string" ? mThinking : undefined,
              tool_calls: Array.isArray(mToolCalls) ? mToolCalls : undefined,
            };

            rawMessages.push(msgObj);
            contextMessages.push({
              role: msgObj.role || (msgObj.type === "ai" ? "assistant" : msgObj.type || "unknown"),
              content: msgObj.content,
              tool_calls: msgObj.tool_calls,
              thinking: msgObj.thinking,
            });
          }
        }

        const toolCalls = rawMessages
          .filter((m) => m.tool_calls && m.tool_calls.length > 0)
          .flatMap((m) => m.tool_calls || []);

        messages.push({
          id: `asst-${turnName}`,
          role: "assistant",
          content: finalResponse || "Task processed.",
          thinking: thinking || undefined,
          toolCalls:
            toolCalls.length > 0
              ? toolCalls.map((tc) => ({
                  name: tc.name,
                  args: tc.args,
                  result: undefined,
                }))
              : undefined,
        });
      }
    } catch {
      // Ignore missing agent.yml
    }

    // 5. Build turn console events for this turn
    const turnEvents = buildTurnEvents({
      prompt: userPrompt,
      threadId: sessionId,
      governorName: "Governor",
      messages: rawMessages.map((m) => ({
        _getType: () => m.type || "ai",
        role: m.role || (m.type === "ai" ? "assistant" : "system"),
        content: m.content,
        additional_kwargs: m.thinking ? { thinking: m.thinking } : {},
        tool_calls: m.tool_calls,
      })),
      pipelineContext: {
        entryToolCalls,
        exitToolCalls,
        preToolLogs,
      },
      thinking,
      turnIndex,
    });

    allConsoleEvents.push(...turnEvents);
  }

  const nextTurnIndex = turnEntries.length + 1;

  return {
    metadata,
    messages,
    contextMessages,
    consoleEvents: allConsoleEvents,
    governorState,
    nextTurnIndex,
  };
}
