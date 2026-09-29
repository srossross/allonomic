import type { AgentFileRow } from "../../types";
import type { TurnEvent } from "./events";

export function applyAgentFiles(rows: AgentFileRow[], event: TurnEvent): AgentFileRow[] {
  if (event.type !== "context_files_loaded") return rows;
  let next = rows;
  for (const file of event.files) {
    const index = next.findIndex((row) => row.agent === event.agent && row.path === file.path);
    const previous = index === -1 ? undefined : next[index];
    const isLatest = !previous || file.loadedAt >= previous.lastLoadedAt;
    const row: AgentFileRow = {
      agent: event.agent,
      path: file.path,
      size: isLatest ? file.size : previous.size,
      missing: isLatest ? file.missing : previous.missing,
      lastLoadedAt: isLatest ? file.loadedAt : previous.lastLoadedAt,
      hooks: previous?.hooks.includes(event.hook)
        ? previous.hooks
        : [...(previous?.hooks ?? []), event.hook],
    };
    next = index === -1 ? [...next, row] : next.map((r, i) => (i === index ? row : r));
  }
  return next;
}
