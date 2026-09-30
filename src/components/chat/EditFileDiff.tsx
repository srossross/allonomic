import { diffLines } from "diff";
import type { ToolCallInfo } from "@/types";

interface DiffRow {
  kind: "added" | "removed" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const ROW_CLASSES: Record<DiffRow["kind"], string> = {
  added: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  removed: "bg-destructive/10 text-destructive",
  context: "",
};

const MARKERS: Record<DiffRow["kind"], string> = { added: "+", removed: "-", context: " " };

function splitLines(value: string) {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineCount(value: string) {
  return value.split("\n").length - 1;
}

function parseStartLines(result: unknown): number[] {
  if (typeof result !== "string") return [];
  const match = /at lines? ([\d, ]+)$/.exec(result);
  return match ? match[1].split(", ").map(Number) : [];
}

function buildRows(oldString: string, newString: string, oldStart?: number, newStart?: number) {
  const rows: DiffRow[] = [];
  let oldLine = oldStart;
  let newLine = newStart;
  for (const change of diffLines(oldString, newString)) {
    const kind = change.added ? "added" : change.removed ? "removed" : "context";
    for (const text of splitLines(change.value)) {
      rows.push({
        kind,
        text,
        oldLine: kind === "added" ? undefined : oldLine,
        newLine: kind === "removed" ? undefined : newLine,
      });
      if (kind !== "added" && oldLine !== undefined) oldLine++;
      if (kind !== "removed" && newLine !== undefined) newLine++;
    }
  }
  return rows;
}

function Hunk({ rows }: { rows: DiffRow[] }) {
  const maxLine = Math.max(0, ...rows.map((row) => Math.max(row.oldLine ?? 0, row.newLine ?? 0)));
  const gutterWidth = `calc(${String(maxLine).length}ch + 0.5rem)`;
  return (
    <pre className="border-border/40 bg-background/60 text-foreground/80 text-2xs max-h-96 overflow-auto rounded-xs border py-1.5 whitespace-pre-wrap">
      {rows.map((row, index) => (
        <div key={index} className={`flex px-1.5 ${ROW_CLASSES[row.kind]}`}>
          <span
            className="text-muted-foreground/60 shrink-0 pr-2 text-right select-none"
            style={{ width: gutterWidth }}
          >
            {row.oldLine ?? ""}
          </span>
          <span
            className="text-muted-foreground/60 shrink-0 pr-2 text-right select-none"
            style={{ width: gutterWidth }}
          >
            {row.newLine ?? ""}
          </span>
          <span className="shrink-0 pr-1 select-none">{MARKERS[row.kind]}</span>
          <span className="min-w-0 flex-1">{row.text}</span>
        </div>
      ))}
    </pre>
  );
}

export function EditFileDiff({ tc }: { tc: ToolCallInfo }) {
  const oldString = String(tc.args?.oldString ?? "");
  const newString = String(tc.args?.newString ?? "");
  const startLines = parseStartLines(tc.result);
  if (startLines.length === 0) return <Hunk rows={buildRows(oldString, newString)} />;
  const lineDelta = lineCount(newString) - lineCount(oldString);
  return (
    <div className="space-y-1.5">
      {startLines.map((start, index) => (
        <Hunk
          key={start}
          rows={buildRows(oldString, newString, start, start + index * lineDelta)}
        />
      ))}
    </div>
  );
}
