import { useEffect, useState } from "react";
import {
  dismissInterruptedJobsApi,
  dismissJobApi,
  killJobApi,
  restartInterruptedJobsApi,
  subscribeJobsApi,
} from "@/agent/api";
import type { JobEvent, JobSnapshot, JobSpec } from "@/core/jobs/backgroundJobs";
import { JOB_OUTPUT_LIMIT } from "@/core/jobs/backgroundJobs";
import { withAlert } from "@/lib/alertError";

interface JobsState {
  jobs: JobSnapshot[];
  interrupted: JobSpec[];
}

const EMPTY: JobsState = { jobs: [], interrupted: [] };

function applyEvent(state: JobsState, event: JobEvent): JobsState {
  switch (event.type) {
    case "job_started": {
      return { ...state, jobs: [...state.jobs, { info: event.job, output: "" }] };
    }
    case "job_output": {
      return {
        ...state,
        jobs: state.jobs.map((job) =>
          job.info.id === event.jobId
            ? { ...job, output: (job.output + event.text).slice(-JOB_OUTPUT_LIMIT) }
            : job
        ),
      };
    }
    case "job_ended": {
      return {
        ...state,
        jobs: state.jobs.map((job) =>
          job.info.id === event.job.id ? { ...job, info: event.job } : job
        ),
      };
    }
    case "job_dismissed": {
      return { ...state, jobs: state.jobs.filter((job) => job.info.id !== event.jobId) };
    }
    case "jobs_interrupted": {
      return { ...state, interrupted: event.specs };
    }
  }
}

export function useBackgroundJobs(workspaceDir: string | undefined, sessionId: string) {
  const [owned, setOwned] = useState<{ sessionId: string; state: JobsState }>({
    sessionId,
    state: EMPTY,
  });
  const state = owned.sessionId === sessionId ? owned.state : EMPTY;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isCancelled = false;
    let pending: JobEvent[] | undefined = [];
    void withAlert("Watch background jobs", async () => {
      const subscription = await subscribeJobsApi(workspaceDir, sessionId, (event) => {
        if (pending) pending.push(event);
        else setOwned((previous) => ({ sessionId, state: applyEvent(previous.state, event) }));
      });
      if (isCancelled) {
        subscription.unsubscribe();
        return;
      }
      unsubscribe = subscription.unsubscribe;
      const buffered = pending ?? [];
      pending = undefined;
      let next: JobsState = subscription.snapshot;
      for (const event of buffered) next = applyEvent(next, event);
      setOwned({ sessionId, state: next });
    });
    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [workspaceDir, sessionId]);

  return {
    ...state,
    kill: (id: string) => void withAlert("Stop job", () => killJobApi(workspaceDir, sessionId, id)),
    dismiss: (id: string) =>
      void withAlert("Close job", () => dismissJobApi(workspaceDir, sessionId, id)),
    restartInterrupted: (indices: number[]) =>
      void withAlert("Restart jobs", () =>
        restartInterruptedJobsApi(workspaceDir, sessionId, indices)
      ),
    dismissInterrupted: () =>
      void withAlert("Dismiss jobs", () => dismissInterruptedJobsApi(workspaceDir, sessionId)),
  };
}
