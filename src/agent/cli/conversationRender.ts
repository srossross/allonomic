import type { GovernorForkMessage, TurnEvent } from "../../core/turn/events";
import type { GovernorState, Assumption } from "../../core/governor/types";
import type { Presentation } from "../../core/ui/presentation";

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

function renderPresentation(presentation: Presentation): string[] {
  const indent = " ".repeat(4);
  return [
    wrap(presentation.response, "  "),
    ...presentation.responseDetails.map(
      ({ answer, body }) => `  ▸ ${answer}\n${dim(wrap(body, indent))}`
    ),
    ...presentation.callouts.map(
      ({ title, details }) => yellow(`  ⚠ ${title}`) + (details ? `\n${wrap(details, indent)}` : "")
    ),
    ...presentation.evidence.map(({ claim, support, gap }) =>
      [
        support.length > 0 ? `  ✓ ${claim}` : yellow(`  ? ${claim} (assumed)`),
        ...support.map(
          ({ source, quote, method, why }) =>
            `${indent}${JSON.stringify(quote)} ${dim(`${method} · ${source}`)}` +
            (why ? `\n${dim(wrap(why, indent))}` : "")
        ),
        ...(gap ? [dim(`${indent}not covered: ${gap}`)] : []),
      ].join("\n")
    ),
    ...(presentation.journey ? [dim(`  journey\n${wrap(presentation.journey, indent)}`)] : []),
    ...presentation.questions.map(
      ({ prompt, options }) => bold(`  ? ${prompt}`) + (options ? `  [${options.join("] [")}]` : "")
    ),
  ];
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
    case "presentation": {
      return [cyan(`\n━━ ${event.interceptor} ━━`), ...renderPresentation(event.presentation)].join(
        "\n"
      );
    }
    default: {
      return dim(`  ${event.type}`);
    }
  }
}

function renderAssumption(assumption: Assumption): string {
  const badge =
    assumption.status === "open" ? yellow(`[${assumption.status}]`) : dim(`[${assumption.status}]`);
  const labels = [
    assumption.id,
    assumption.depends_on && `depends_on:${assumption.depends_on}`,
    assumption.resolver,
    assumption.impact_category,
    assumption.candidates && `candidates:${assumption.candidates}`,
    assumption.impact_cost && `cost:${assumption.impact_cost}`,
    assumption.user_would_care !== null &&
      (assumption.user_would_care ? "user-would-care" : "user-would-not-care"),
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `  ${badge} ${bold(assumption.text)}`,
    `      ${dim(labels)}`,
    assumption.request && `      ${dim("request:")} ${assumption.request}`,
    assumption.evidence && `      ${dim("evidence:")} ${JSON.stringify(assumption.evidence)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderAssumptions(state: GovernorState): string {
  const intents = [...state.intent_stack, ...state.completed_intents].filter((intent) =>
    state.assumptions.some((a) => a.intent_id === intent.id)
  );
  if (intents.length === 0) return dim("  (no assumptions)");
  return intents
    .map((intent) => {
      const assumptions = state.assumptions.filter((a) => a.intent_id === intent.id);
      const head = `\n${cyan(`[${intent.kind}]`)} ${bold(intent.description)}`;
      return `${head}\n${assumptions.map((a) => renderAssumption(a)).join("\n")}`;
    })
    .join("\n");
}
