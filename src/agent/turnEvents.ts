import type { ConsoleEvent } from "@/types";
import { type MessageLike } from "./messageExtractors";

interface BuildTurnEventsParameters {
  prompt: string;
  threadId?: string;
  governorName: string;
  messages: MessageLike[];
  pipelineContext?: {
    entryToolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
    exitToolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
    preToolLogs?: Array<{ tool: string; approved: boolean; reason?: string }>;
  };
  thinking?: string;
  retries?: number;
  turnIndex?: number;
}

export function buildTurnEvents({
  prompt,
  threadId,
  governorName,
  messages,
  pipelineContext,
  thinking,
  retries,
  turnIndex,
}: BuildTurnEventsParameters): ConsoleEvent[] {
  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const govBadge = `GOV:${governorName}`;
  let seq = 0;
  const nextId = () => `evt-${Date.now()}-${seq++}`;

  // 1. User Prompt Submitted
  const events: ConsoleEvent[] = [
    {
      id: nextId(),
      timestamp,
      type: "user_prompt",
      badge: "USER",
      badgeVariant: "sky",
      summary: prompt,
      details: { prompt, threadId },
    },
  ];

  // 2. Governor Entry Intercept Tool Calls
  if (pipelineContext?.entryToolCalls) {
    for (const call of pipelineContext.entryToolCalls) {
      events.push({
        id: nextId(),
        timestamp,
        type: "governor_entry",
        badge: govBadge,
        badgeVariant: "purple",
        summary: `${call.name}: ${
          call.name === "push_intent"
            ? `(${call.args?.kind || "intent"}) "${call.args?.description || ""}"`
            : call.name === "add_constraint"
              ? `constraint "${call.args?.constraint || ""}"`
              : JSON.stringify(call.args || {})
        }`,
        details: call,
      });
    }
  }

  // 3. Worker Messages & Pre-Tool Intercepts
  const preLogs = [...(pipelineContext?.preToolLogs || [])];
  for (const m of messages) {
    const type = typeof m._getType === "function" ? m._getType() : m.role;

    if (type === "ai") {
      let messageThinking = m.additional_kwargs?.thinking || "";
      if (!messageThinking && Array.isArray(m.content)) {
        const thoughts = m.content.filter(
          (c: unknown) =>
            typeof c === "object" &&
            c !== null &&
            Boolean(Reflect.get(c, "thought") || Reflect.get(c, "type") === "thought")
        );
        if (thoughts.length > 0) {
          messageThinking = thoughts
            .map((t: unknown) => {
              if (typeof t !== "object" || t === null) {
                return "";
              }
              const text = Reflect.get(t, "text");
              return typeof text === "string" ? text : "";
            })
            .join("\n");
        }
      }

      if (messageThinking) {
        events.push({
          id: nextId(),
          timestamp,
          type: "worker_thought",
          badge: "AGENT",
          badgeVariant: "purple",
          summary: `Thinking (${messageThinking.trim().split("\n").length} lines): ${messageThinking
            .slice(0, 80)
            .replaceAll("\n", " ")}...`,
          details: { thinking: messageThinking },
        });
      }

      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          events.push({
            id: nextId(),
            timestamp,
            type: "worker_tool_call",
            badge: "AGENT",
            badgeVariant: "amber",
            summary: `${tc.name}(${JSON.stringify(tc.args)})`,
            details: tc,
          });

          const matchingPre = preLogs.find((p) => p.tool === tc.name);
          if (matchingPre) {
            events.push({
              id: nextId(),
              timestamp,
              type: "governor_pre_tool",
              badge: govBadge,
              badgeVariant: matchingPre.approved ? "purple" : "destructive",
              summary: matchingPre.approved
                ? `Approved ${tc.name}`
                : `Blocked ${tc.name}: ${matchingPre.reason || "Disallowed"}`,
              details: matchingPre,
            });
          }
        }
      } else if (m.content) {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        events.push({
          id: nextId(),
          timestamp,
          type: "worker_response",
          badge: "AGENT",
          badgeVariant: "emerald",
          summary: text.slice(0, 120),
          details: { content: m.content },
        });
      }
    } else if (type === "tool") {
      const contentString = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      events.push({
        id: nextId(),
        timestamp,
        type: "tool_result",
        badge: "TOOL",
        badgeVariant: "neutral",
        summary: `Result of ${m.name || "tool"}: ${contentString.slice(0, 100)}`,
        details: { name: m.name, content: m.content },
      });
    }
  }

  // 4. Governor Exit Intercept Tool Calls
  if (pipelineContext?.exitToolCalls) {
    for (const call of pipelineContext.exitToolCalls) {
      events.push({
        id: nextId(),
        timestamp,
        type: "governor_exit",
        badge: govBadge,
        badgeVariant: "purple",
        summary: `${call.name}: ${
          call.name === "resolve_intent"
            ? `satisfied '${call.args?.id || ""}'`
            : call.name === "finish"
              ? `approved: ${call.args?.approved ?? true}${
                  call.args?.feedback ? ` (feedback: "${call.args.feedback}")` : ""
                }`
              : JSON.stringify(call.args || {})
        }`,
        details: call,
      });
    }
  }

  // 5. Fallback Thinking
  if (thinking && events.every((e) => e.type !== "worker_thought")) {
    events.push({
      id: nextId(),
      timestamp,
      type: "worker_thought",
      badge: "AGENT",
      badgeVariant: "purple",
      summary: `Thinking (${thinking.trim().split("\n").length} lines): ${thinking
        .slice(0, 80)
        .replaceAll("\n", " ")}...`,
      details: { thinking },
    });
  }

  // 6. Turn Complete
  events.push({
    id: nextId(),
    timestamp,
    type: "turn_complete",
    badge: "DONE",
    badgeVariant: "emerald",
    summary: `Turn complete (retries: ${retries ?? 0})`,
    details: { retries, turnIndex },
  });

  return events;
}

export {
  extractAssistantText,
  extractContextMessages,
  extractTurnToolCalls,
  type MessageLike,
} from "./messageExtractors";
