import type { GovernorForkMessage, TurnEvent } from "../../core/turn/events";
import type { GovernorState, FalseCompletion } from "../../core/governor/types";

const colorState = { isEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR };

export function setColor(isEnabled: boolean) {
  colorState.isEnabled = isEnabled;
}

const paint = (code: string) => (text: string) =>
  colorState.isEnabled ? `\u{1B}[${code}m${text}\u{1B}[0m` : text;

export const dim = paint("2");
export const bold = paint("1");
export const magenta = paint("35");
export const cyan = paint("36");
export const yellow = paint("33");
export const red = paint("31");
export const green = paint("32");

const width = Math.min(process.stdout.columns ?? 100, 120);

function wrap(text: string, indent: string): string {
  const limit = width - indent.length;
  return text
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (line && line.length + 1 + word.length > limit) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) lines.push(line);
      return lines.map((l) => indent + l).join("\n");
    })
    .join("\n");
}

function renderValue(value: unknown, indent: string): string {
  if (typeof value === "string") {
    return value.includes("\n") ? `\n${wrap(value, `${indent}  `)}` : ` ${value}`;
  }
  if (value === null || value === undefined) return dim(" null");
  if (typeof value !== "object") return ` ${String(value)}`;
  const entries = Object.entries(value);
  if (entries.length === 0) return dim(" {}");
  return `\n${entries
    .map(([key, v]) => `${indent}  ${dim(`${key}:`)}${renderValue(v, `${indent}  `)}`)
    .join("\n")}`;
}

function renderForkMessage(message: GovernorForkMessage): string[] {
  if (message.role === "user") return [];
  const indent = " ".repeat(4);
  if (message.role === "tool") {
    return [dim(`${indent}→ ${message.name}: ${message.content.slice(0, width - 12)}`)];
  }
  const out: string[] = [];
  if (message.thinking) {
    out.push(magenta(`  ${dim("thinking")}`), wrap(message.thinking, indent));
  }
  if (message.content) out.push(magenta(`  ${dim("text")}`), wrap(message.content, indent));
  for (const call of message.toolCalls) {
    out.push(`  ${magenta("call")} ${bold(call.name)}${renderValue(call.args, "  ")}`);
  }
  return out;
}

export function renderEvent(event: TurnEvent): string | null {
  switch (event.type) {
    case "turn_started": {
      return cyan(`▶ Turn ${event.turnIndex}`) + (event.prompt ? `  ${event.prompt}` : "");
    }
    case "governor_fork": {
      const header = magenta(
        `\n━━ ${event.interceptor} · ${event.phase ? `${event.phase} · ` : ""}${event.pass} ━━`
      );
      return [header, ...event.messages.flatMap((m) => renderForkMessage(m))].join("\n");
    }
    case "governor_verdict": {
      return event.approved
        ? null
        : red(`  ✗ ${event.interceptor} ${event.phase} finish rejected`) +
            (event.feedback ? `\n${wrap(event.feedback, " ".repeat(4))}` : "");
    }
    case "governor_action": {
      return null;
    }
    case "governor_tool_decision": {
      return dim(`  pre-tool ${event.approved ? "allow" : "deny"} ${event.tool}`);
    }
    case "model_step": {
      return dim(
        `  worker → ${event.toolCalls.length > 0 ? event.toolCalls.map((t) => t.name).join(", ") : "response"}`
      );
    }
    case "tool_result": {
      return dim(`  ${event.name} → ${event.content.slice(0, 80).replaceAll("\n", " ")}`);
    }
    case "turn_failed": {
      return event.aborted ? null : red(`✗ ${event.error}`);
    }
    default: {
      return dim(`  ${event.type}`);
    }
  }
}

function renderFalseCompletion(falseCompletion: FalseCompletion): string {
  const status = falseCompletion.resolution ?? "open";
  const badge = status === "open" ? yellow(`[${status}]`) : dim(`[${status}]`);
  const evidence = falseCompletion.evidence
    ? `${dim(falseCompletion.evidence.source)} ${JSON.stringify(falseCompletion.evidence.quote)}`
    : dim("none");
  return [
    `  ${badge} ${bold(falseCompletion.summary)}`,
    `      ${dim("relies on:")}     ${falseCompletion.relies_on}`,
    `      ${dim("completes as:")}  ${falseCompletion.completes_as}`,
    `      ${dim("false because:")} ${falseCompletion.false_because}`,
    `      ${dim("detect by:")}     ${falseCompletion.detect_by ?? dim("none")}`,
    `      ${dim("evidence:")}      ${evidence}`,
  ].join("\n");
}

export function renderFalseCompletions(state: GovernorState): string {
  const active = state.intent_stack.map((intent) => ({ intent, isDone: false }));
  const done = state.completed_intents
    .filter((intent) => state.false_completions.some((r) => r.intent_id === intent.id))
    .map((intent) => ({ intent, isDone: true }));
  return [...active, ...done]
    .map(({ intent, isDone }) => {
      const falseCompletions = state.false_completions.filter((r) => r.intent_id === intent.id);
      const tag = isDone ? dim(`[${intent.kind} · done]`) : cyan(`[${intent.kind}]`);
      const head = `\n${tag} ${bold(intent.description)}`;
      return falseCompletions.length === 0
        ? `${head}\n  ${dim("(no false completions)")}`
        : `${head}\n${falseCompletions.map((r) => renderFalseCompletion(r)).join("\n")}`;
    })
    .join("\n");
}
