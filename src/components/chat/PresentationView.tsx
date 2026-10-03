import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { AlertTriangle, Check, CircleDashed, HelpCircle } from "lucide-react";
import type { Message, ToolCallInfo } from "@/types";
import { USER_SOURCE, type Evidence, type Presentation } from "@/core/ui/presentation";
import { EditFileDiff } from "./EditFileDiff";

type Panel = "evidence" | "journey" | "diff";

const PROSE =
  "text-xs leading-relaxed [&_code]:bg-muted [&_code]:rounded-xs [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_pre]:overflow-x-auto [&_table]:my-1 [&_td]:border [&_td]:px-1.5 [&_th]:border [&_th]:px-1.5 [&_ul]:list-disc";

function sourceLabel(source: string, turn: Message[]): string {
  if (source === USER_SOURCE) return "your message";
  const tc = turn.flatMap((m) => m.toolCalls ?? []).find((call) => call.id === source);
  if (!tc) return source;
  const args = tc.args ?? {};
  return String(args.command || args.cmd || args.filePath || args.path || tc.name);
}

function revealToolCall(id: string) {
  document
    .querySelector(`[data-tool-call-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function EvidencePanel({ evidence, turn }: { evidence: Evidence[]; turn: Message[] }) {
  const ordered = evidence.toSorted(
    (a, b) => Number(a.support.length > 0) - Number(b.support.length > 0)
  );
  return (
    <div className="space-y-3">
      {ordered.map(({ claim, support, gap }, index) => (
        <div key={index} className="space-y-1 text-xs">
          <div className="flex items-start gap-2">
            {support.length > 0 ? (
              <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
            ) : (
              <HelpCircle className="mt-0.5 size-3 shrink-0 text-amber-600" />
            )}
            <span className="flex-1">
              {claim}
              {support.length === 0 && <span className="ml-2 text-amber-600">assumed</span>}
            </span>
          </div>
          {support.map(({ source, quote, method, why }, supportIndex) => (
            <div key={supportIndex} className="ml-5 space-y-0.5">
              <pre className="border-border/60 bg-muted/30 text-2xs max-h-40 overflow-auto border-l-2 py-1 pl-2 font-mono whitespace-pre-wrap">
                {quote}
              </pre>
              <div className="text-muted-foreground text-2xs flex min-w-0 gap-1.5">
                <span className="shrink-0">{method}</span>
                <span className="shrink-0">·</span>
                {source === USER_SOURCE ? (
                  <span>{sourceLabel(source, turn)}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => revealToolCall(source)}
                    title={sourceLabel(source, turn)}
                    className="hover:text-foreground min-w-0 cursor-pointer truncate font-mono"
                  >
                    {sourceLabel(source, turn)}
                  </button>
                )}
              </div>
              {why && <div className="text-muted-foreground text-2xs">{why}</div>}
            </div>
          ))}
          {gap && <div className="text-muted-foreground ml-5">not covered: {gap}</div>}
        </div>
      ))}
    </div>
  );
}

function Md({ children }: { children: string }) {
  return (
    <div className={PROSE}>
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

function fileEdits(turn: Message[]): ToolCallInfo[] {
  return turn
    .flatMap((m) => m.toolCalls ?? [])
    .filter(
      (tc) => (tc.name === "edit_file" || tc.name === "write_file") && tc.status === "executed"
    );
}

function lineStats(edits: ToolCallInfo[]) {
  let added = 0;
  let removed = 0;
  for (const tc of edits) {
    const oldString = tc.name === "edit_file" ? String(tc.args?.oldString ?? "") : "";
    const newString = String(tc.args?.[tc.name === "edit_file" ? "newString" : "content"] ?? "");
    for (const change of diffLines(oldString, newString)) {
      if (change.added) added += change.count ?? 0;
      if (change.removed) removed += change.count ?? 0;
    }
  }
  return { added, removed };
}

interface PresentationViewProps {
  presentation: Presentation;
  turn: Message[];
  openIntents: string[];
  isActive: boolean;
  onSend: (text: string) => void;
}

export function PresentationView({
  presentation,
  turn,
  openIntents,
  isActive,
  onSend,
}: PresentationViewProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const { response, responseDetails, callouts, questions, evidence, journey } = presentation;
  const edits = fileEdits(turn);
  const { added, removed } = lineStats(edits);
  const assumed = evidence.filter((item) => item.support.length === 0).length;
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));

  const chip = (key: Panel, label: string) => (
    <button
      type="button"
      onClick={() => toggle(key)}
      className={`border-border/60 hover:bg-muted text-2xs cursor-pointer rounded-xs border px-1.5 py-0.5 font-mono ${
        panel === key ? "bg-muted" : ""
      }`}
    >
      {label}
    </button>
  );

  const reply = (question: string, value: string) => onSend(`${question}\n\n${value}`);

  return (
    <div className="border-border/50 w-full space-y-2 border-t pt-2">
      {isActive &&
        openIntents.map((intent) => (
          <div key={intent} className="text-muted-foreground flex items-center gap-2 text-xs">
            <CircleDashed className="size-3 shrink-0" />
            <span className="flex-1">open: {intent}</span>
            {questions.length === 0 && (
              <button
                type="button"
                onClick={() => onSend(`Continue with: ${intent}`)}
                className="border-border/60 hover:bg-muted cursor-pointer rounded-xs border px-2 py-0.5"
              >
                Continue
              </button>
            )}
          </div>
        ))}

      <Md>{response}</Md>

      {responseDetails.map(({ answer, body }, index) => (
        <details key={index} className="text-xs">
          <summary className="cursor-pointer">{answer}</summary>
          <div className="mt-1 ml-4">
            <Md>{body}</Md>
          </div>
        </details>
      ))}

      {callouts.map(({ title, details }, index) => {
        const heading = (
          <span className="flex items-center gap-2 text-xs">
            <AlertTriangle className="size-3 shrink-0 text-amber-600" />
            {title}
          </span>
        );
        return (
          <div
            key={index}
            className="rounded-xs border border-amber-500/30 bg-amber-500/10 px-2 py-1"
          >
            {details ? (
              <details>
                <summary className="cursor-pointer">{heading}</summary>
                <div className="mt-1 ml-5">
                  <Md>{details}</Md>
                </div>
              </details>
            ) : (
              heading
            )}
          </div>
        );
      })}

      {(evidence.length > 0 || journey || edits.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {evidence.length > 0 &&
            chip(
              "evidence",
              `evidence ${evidence.length}${assumed > 0 ? ` · ${assumed} assumed` : ""}`
            )}
          {journey && chip("journey", "journey")}
          {edits.length > 0 && chip("diff", `diff +${added} −${removed}`)}
        </div>
      )}

      {panel === "evidence" && <EvidencePanel evidence={evidence} turn={turn} />}

      {panel === "journey" && journey && <Md>{journey}</Md>}

      {panel === "diff" && (
        <div className="space-y-1.5">
          {edits.map((tc) => (
            <div key={tc.id} className="space-y-0.5">
              <div className="text-muted-foreground text-2xs font-mono">
                {String(tc.args?.filePath ?? "")}
                {tc.name === "write_file" && " (written)"}
              </div>
              {tc.name === "edit_file" && <EditFileDiff tc={tc} />}
            </div>
          ))}
        </div>
      )}

      {questions.map((question, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 text-xs">
          <HelpCircle className="size-3 shrink-0" />
          <span className="flex-1 font-medium">{question.prompt}</span>
          {(question.options ?? ["Yes"]).map((option) => (
            <button
              key={option}
              type="button"
              disabled={!isActive}
              onClick={() => reply(question.prompt, option)}
              className="border-border/60 hover:bg-muted cursor-pointer rounded-xs border px-2 py-0.5 disabled:cursor-default disabled:opacity-40"
            >
              {option}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
