import { tool } from "@langchain/core/tools";
import type { BackgroundJobs, JobInfo, JobSpec } from "../jobs/backgroundJobs";
import { TOOL_SPECS } from "./specs";

export const BACKGROUND_SETTLE_MS = 1000;
export const WAIT_FOR_TIMEOUT_MS = 30_000;

function jobStatus(info: JobInfo) {
  if (info.status === "running") return "running";
  return info.status === "killed" ? "killed" : `exited ${info.exitCode ?? "killed"}`;
}

export function formatJobFooter(info: JobInfo, note?: string): string {
  const suffix = note ? `; ${note}` : "";
  return `[${info.id} ${jobStatus(info)}${suffix}; output in ${info.logPath}]`;
}

async function settle(
  jobs: BackgroundJobs,
  id: string,
  waitFor?: string
): Promise<string | undefined> {
  if (waitFor === undefined) {
    await jobs.waitFor(id, /(?!)/, BACKGROUND_SETTLE_MS);
    return undefined;
  }
  const result = await jobs.waitFor(id, new RegExp(waitFor), WAIT_FOR_TIMEOUT_MS);
  return result === "timeout"
    ? `wait_for ${JSON.stringify(waitFor)} not seen after ${WAIT_FOR_TIMEOUT_MS / 1000}s`
    : undefined;
}

export async function startBackgroundJob(
  jobs: BackgroundJobs,
  spec: JobSpec,
  waitFor?: string
): Promise<string> {
  const { id } = await jobs.start(spec);
  const note = await settle(jobs, id, waitFor);
  await jobs.flushLog(id);
  const job = jobs.read(id);
  if (!job) throw new Error(`job ${id} disappeared`);
  const body = job.output.trim() || "(no output yet)";
  return `Started background job ${id}.\n${body}\n${formatJobFooter(job.info, note)}`;
}

export function createJobTools(jobs: BackgroundJobs) {
  return [
    tool(async ({ job_id }: { job_id: string }) => {
      const isKilled = await jobs.kill(job_id);
      const job = jobs.read(job_id);
      if (!job) return `Error: no background job ${job_id}`;
      return formatJobFooter(job.info, isKilled ? undefined : "was not running");
    }, TOOL_SPECS.shellJobKill),
  ];
}
