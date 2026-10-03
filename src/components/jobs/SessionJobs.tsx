import { useEffect, useRef, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, Loader2, RotateCcw, Square, X } from "lucide-react";
import type { JobInfo, JobSnapshot, JobSpec } from "@/core/jobs/backgroundJobs";
import { useBackgroundJobs } from "@/hooks/useBackgroundJobs";
import { TAB_BAR_CLASS, tabCellClass } from "@/components/tabs/tabStyles";
import { activateOnKey } from "@/lib/activateOnKey";
import { withAlert } from "@/lib/alertError";

const WORKER_TAB = "worker";

function JobStatusIcon({ info }: { info: JobInfo }) {
  if (info.status === "running")
    return <Loader2 className="size-3 animate-spin text-blue-500" aria-label="Running" />;
  return info.status === "exited" && info.exitCode === 0 ? (
    <Check className="size-3 text-emerald-500" aria-label="Exited 0" />
  ) : (
    <X className="text-destructive size-3" aria-label={`Ended (${info.status})`} />
  );
}

function jobState(info: JobInfo) {
  if (info.status === "running") return "running";
  return info.status === "killed" ? "killed" : `exit ${info.exitCode ?? "killed"}`;
}

function JobOutputView({ job, onKill }: { job: JobSnapshot; onKill: () => void }) {
  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [job.output]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/80 text-muted-foreground flex items-center gap-2 border-b px-3 py-1.5 font-mono text-xs">
        <JobStatusIcon info={job.info} />
        <span
          className="text-foreground min-w-0 flex-1 truncate font-semibold"
          title={job.info.command}
        >
          {job.info.command}
        </span>
        <span>{jobState(job.info)}</span>
        {job.info.status === "running" && (
          <button
            type="button"
            onClick={onKill}
            className="hover:text-destructive flex cursor-pointer items-center gap-1 transition-colors"
            title="Stop job"
          >
            <Square className="size-3 fill-current" />
            Stop
          </button>
        )}
      </div>
      <pre
        ref={scrollRef}
        className="text-foreground/80 min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap select-text"
      >
        {job.output || "(no output yet)"}
      </pre>
    </div>
  );
}

function InterruptedJobsBanner({
  specs,
  onRestart,
  onDismiss,
}: {
  specs: JobSpec[];
  onRestart: (indices: number[]) => void;
  onDismiss: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(specs.map((_, index) => index))
  );
  const toggle = (index: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <div className="border-border/80 space-y-1.5 border-b bg-amber-500/10 px-3 py-2 text-xs">
      <div className="font-medium">
        Background jobs were running when the app closed. Start them again?
      </div>
      {specs.map((spec, index) => (
        <label key={index} className="flex cursor-pointer items-center gap-2 font-mono">
          <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
          <span className="truncate" title={spec.command}>
            {spec.command}
          </span>
        </label>
      ))}
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => onRestart([...selected])}
          className="border-border hover:bg-muted flex cursor-pointer items-center gap-1 rounded-xs border px-2 py-0.5 disabled:cursor-default disabled:opacity-50"
        >
          <RotateCcw className="size-3" />
          Start selected
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground cursor-pointer px-2 py-0.5"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function SessionJobs({
  workspaceDir,
  sessionId,
  children,
}: {
  workspaceDir: string | undefined;
  sessionId: string;
  children: ReactNode;
}) {
  const { jobs, interrupted, kill, dismiss, restartInterrupted, dismissInterrupted } =
    useBackgroundJobs(workspaceDir, sessionId);
  const [selection, setSelection] = useState({ sessionId, tab: WORKER_TAB });
  const activeTab = selection.sessionId === sessionId ? selection.tab : WORKER_TAB;
  const setActiveTab = (tab: string) => setSelection({ sessionId, tab });
  const activeJob = jobs.find((job) => job.info.id === activeTab);
  const isWorker = activeJob === undefined;

  const close = (job: JobSnapshot) =>
    void withAlert("Close job", async () => {
      if (
        job.info.status === "running" &&
        !(await ask(`Stop "${job.info.command}"?`, { title: "Job is running", kind: "warning" }))
      )
        return;
      if (activeTab === job.info.id) setActiveTab(WORKER_TAB);
      dismiss(job.info.id);
    });

  return (
    <>
      {interrupted.length > 0 && (
        <InterruptedJobsBanner
          key={interrupted.map((spec) => spec.command).join("\n")}
          specs={interrupted}
          onRestart={restartInterrupted}
          onDismiss={dismissInterrupted}
        />
      )}
      {jobs.length > 0 && (
        <div className={`${TAB_BAR_CLASS} overflow-x-auto`}>
          <div className="flex h-full min-w-0 flex-1 items-center">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab(WORKER_TAB)}
              onKeyDown={activateOnKey(() => setActiveTab(WORKER_TAB))}
              className={tabCellClass(isWorker)}
            >
              <span className="text-xs">worker</span>
            </div>
            {jobs.map((job) => (
              <div
                key={job.info.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab(job.info.id)}
                onKeyDown={activateOnKey(() => setActiveTab(job.info.id))}
                className={`group max-w-60 ${tabCellClass(job === activeJob)}`}
                title={job.info.command}
              >
                <span className="flex-1 truncate font-mono text-xs">{job.info.command}</span>
                <JobStatusIcon info={job.info} />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    close(job);
                  }}
                  className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-xs p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Close job tab"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={isWorker ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{children}</div>
      {activeJob && <JobOutputView job={activeJob} onKill={() => kill(activeJob.info.id)} />}
    </>
  );
}
