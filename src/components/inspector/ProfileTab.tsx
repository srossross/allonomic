import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Profile, ProfileSpan, ProfileTurn } from "@/core/turn/profile";
import { RATE_LIMIT_SOURCE, TOOL_SOURCE, USER_SOURCE, WORKER_SOURCE } from "@/core/turn/waiting";

const SOURCE_STYLES: Record<string, { label: string; bar: string }> = {
  [WORKER_SOURCE]: { label: "Worker model", bar: "bg-primary" },
  Governor: { label: "Governor", bar: "bg-emerald-500" },
  ToolTeacher: { label: "ToolTeacher", bar: "bg-amber-500" },
  [TOOL_SOURCE]: { label: "Tools", bar: "bg-muted-foreground/60" },
  [RATE_LIMIT_SOURCE]: { label: "Rate limit", bar: "bg-destructive" },
  [USER_SOURCE]: { label: "Waiting on you", bar: "bg-sky-400" },
};

const OTHER_STYLE = { label: "Other", bar: "bg-muted-foreground/30" };
const SLOWEST_COUNT = 5;

function styleOf(source: string) {
  return SOURCE_STYLES[source] ?? { ...OTHER_STYLE, label: source };
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function turnDuration(turn: ProfileTurn, spans: ProfileSpan[]): number {
  const lastSpanEnd = Math.max(
    turn.startMs,
    ...spans.filter((s) => s.turnIndex === turn.turnIndex).map((s) => s.startMs + s.durationMs)
  );
  return (turn.endMs ?? lastSpanEnd) - turn.startMs;
}

interface SourceTotal {
  source: string;
  hook?: string;
  totalMs: number;
  count: number;
}

function totalsBySourceAndHook(spans: ProfileSpan[]): SourceTotal[] {
  const totals: Record<string, SourceTotal> = {};
  const sourceMs: Record<string, number> = {};
  for (const span of spans) {
    const key = `${span.source}:${span.hook ?? ""}`;
    const current = totals[key] ?? { source: span.source, hook: span.hook, totalMs: 0, count: 0 };
    totals[key] = {
      ...current,
      totalMs: current.totalMs + span.durationMs,
      count: current.count + 1,
    };
    sourceMs[span.source] = (sourceMs[span.source] ?? 0) + span.durationMs;
  }
  return Object.values(totals).toSorted(
    (a, b) =>
      (sourceMs[b.source] ?? 0) - (sourceMs[a.source] ?? 0) ||
      a.source.localeCompare(b.source) ||
      b.totalMs - a.totalMs
  );
}

function Bar({ fraction, className }: { fraction: number; className: string }) {
  return (
    <div className="bg-muted/40 h-2 flex-1 overflow-hidden rounded-xs">
      <div
        className={`h-full ${className}`}
        style={{ width: `${Math.min(100, fraction * 100)}%` }}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground text-2xs mb-1 font-mono font-semibold tracking-wider uppercase">
      {children}
    </div>
  );
}

function rowKey({ source, hook }: { source: string; hook?: string }): string {
  return `${source || "other"}:${hook ?? ""}`;
}

function BySource({
  spans,
  totalMs,
  excluded,
  onToggle,
}: {
  spans: ProfileSpan[];
  totalMs: number;
  excluded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const totals = totalsBySourceAndHook(spans);
  const attributedMs = totals.reduce((sum, t) => sum + t.totalMs, 0);
  const unattributedMs = totalMs - attributedMs;
  const rows: SourceTotal[] =
    unattributedMs > 0 ? [...totals, { source: "", totalMs: unattributedMs, count: 0 }] : totals;
  const includedMs = rows
    .filter((row) => !excluded.has(rowKey(row)))
    .reduce((sum, row) => sum + row.totalMs, 0);

  return (
    <div>
      <SectionTitle>By source</SectionTitle>
      <div className="space-y-1">
        {rows.map(({ source, hook, totalMs: sourceMs, count }) => {
          const key = rowKey({ source, hook });
          const isIncluded = !excluded.has(key);
          const style = source ? styleOf(source) : OTHER_STYLE;
          const fraction = isIncluded && includedMs > 0 ? sourceMs / includedMs : 0;
          return (
            <div key={key} className="flex items-center gap-2 font-mono text-xs">
              <Checkbox checked={isIncluded} onCheckedChange={() => onToggle(key)} />
              <span className="text-foreground w-44 truncate">
                {style.label}
                {hook && <span className="text-muted-foreground"> · {hook}</span>}
              </span>
              <Bar fraction={fraction} className={style.bar} />
              <span className="text-foreground w-12 text-right">{formatMs(sourceMs)}</span>
              <span className="text-muted-foreground w-9 text-right">
                {isIncluded ? `${Math.round(fraction * 100)}%` : "—"}
              </span>
              <span className="text-muted-foreground w-8 text-right">
                {count ? `×${count}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({ spans, turn }: { spans: ProfileSpan[]; turn: ProfileTurn }) {
  const totalMs = Math.max(1, turnDuration(turn, spans));
  return (
    <div>
      <SectionTitle>Timeline</SectionTitle>
      <div className="space-y-0.5">
        {spans.map((span, index) => {
          const left = ((span.startMs - turn.startMs) / totalMs) * 100;
          const width = Math.max(0.5, (span.durationMs / totalMs) * 100);
          return (
            <div key={index} className="flex items-center gap-2 font-mono text-xs">
              <div className="relative h-2 flex-1">
                <div
                  className={`absolute h-full rounded-xs ${styleOf(span.source).bar}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <span className="text-foreground w-44 truncate">{span.on}</span>
              <span className="text-muted-foreground w-12 text-right">
                {formatMs(span.durationMs)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Slowest({ spans }: { spans: ProfileSpan[] }) {
  const slowest = spans
    .filter((s) => s.source !== USER_SOURCE)
    .toSorted((a, b) => b.durationMs - a.durationMs)
    .slice(0, SLOWEST_COUNT);
  return (
    <div>
      <SectionTitle>Slowest</SectionTitle>
      <div className="space-y-0.5">
        {slowest.map((span, index) => (
          <div key={index} className="flex items-center gap-2 font-mono text-xs">
            <span className="text-foreground flex-1 truncate">{span.on}</span>
            <span className="text-foreground w-12 text-right">{formatMs(span.durationMs)}</span>
            <span className="text-muted-foreground w-14 text-right">turn {span.turnIndex}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileTab({ profile }: { profile: Profile }) {
  const [selectedTurn, setSelectedTurn] = useState<number | "all">("all");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set([rowKey({ source: USER_SOURCE })])
  );

  if (profile.turns.length === 0) {
    return <div className="text-muted-foreground p-3 font-mono text-xs">No turns yet.</div>;
  }

  const toggleExcluded = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const turns = profile.turns.filter((t) => selectedTurn === "all" || t.turnIndex === selectedTurn);
  const turnIndexes = new Set(turns.map((t) => t.turnIndex));
  const spans = profile.spans.filter((s) => turnIndexes.has(s.turnIndex));
  const totalMs = turns.reduce((sum, turn) => sum + turnDuration(turn, profile.spans), 0);
  const timelineTurn = selectedTurn === "all" ? undefined : turns[0];

  return (
    <div className="space-y-4 px-1">
      <div className="flex items-center justify-between font-mono text-xs">
        <select
          value={selectedTurn}
          onChange={(e) =>
            setSelectedTurn(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="border-border/60 text-foreground rounded-xs border bg-transparent px-1 py-0.5"
        >
          <option value="all">All turns</option>
          {profile.turns.map((t) => (
            <option key={t.turnIndex} value={t.turnIndex}>
              Turn {t.turnIndex}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">
          total <span className="text-foreground">{formatMs(totalMs)}</span>
        </span>
      </div>

      <BySource spans={spans} totalMs={totalMs} excluded={excluded} onToggle={toggleExcluded} />

      {timelineTurn ? (
        <Timeline spans={spans} turn={timelineTurn} />
      ) : (
        <div className="text-muted-foreground font-mono text-xs">
          Select a turn to see its timeline.
        </div>
      )}

      <Slowest spans={spans} />
    </div>
  );
}
