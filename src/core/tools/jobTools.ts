import { tool } from "@langchain/core/tools";
import type { BackgroundJobs, JobInfo, JobSpec } from "../jobs/backgroundJobs";
import { TOOL_SPECS } from "./specs";

import { BACKGROUND_STARTUP_MS } from "./shellLimits";

function jobStatus(info: JobInfo) {
  if (info.status === "running") return "running";
  return info.status === "killed" ? "killed" : `exited ${info.exitCode ?? "killed"}`;
}

export function formatJobFooter(info: JobInfo, note?: string): string {
  const suffix = note ? `; ${note}` : "";
  return `[${info.id} ${jobStatus(info)}${suffix}; output in ${info.logPath}]`;
}

export async function startBackgroundJob(
  jobs: BackgroundJobs,
  spec: JobSpec,
  startupMs = BACKGROUND_STARTUP_MS,
  toolCallId?: string
): Promise<{ content: string; logPath: string }> {
  const { id } = await jobs.start(spec, toolCallId);
  await jobs.waitFor(id, /(?!)/, startupMs);
  await jobs.flushLog(id);
  const job = jobs.read(id);
  if (!job) throw new Error(`job ${id} disappeared`);
  const body = job.output.trim() || "(no output yet)";
  return {
    content: `Started background job ${id}.\n${body}\n${formatJobFooter(job.info)}`,
    logPath: job.info.logPath,
  };
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
