import { z } from "zod";
import type { FileStore, Shell, ShellProcess } from "../ports";
import { terminateProcess } from "../superviseProcess";
import { join } from "../paths";

export const JOB_OUTPUT_LIMIT = 1_000_000;
const JOBS_FILE = "jobs.json";

const jobSpecSchema = z.object({
  command: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  toolName: z.string(),
});

export type JobSpec = z.infer<typeof jobSpecSchema>;
export type JobStatus = "running" | "exited" | "killed";

export interface JobInfo extends JobSpec {
  id: string;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  logPath: string;
}

export interface JobSnapshot {
  info: JobInfo;
  output: string;
}

export type JobEvent =
  | { type: "job_started"; job: JobInfo }
  | { type: "job_output"; jobId: string; text: string }
  | { type: "job_ended"; job: JobInfo }
  | { type: "job_dismissed"; jobId: string }
  | { type: "jobs_interrupted"; specs: JobSpec[] };

export type JobListener = (event: JobEvent) => void;

export interface JobLaunch {
  program: string;
  args: string[];
  cwd: string;
  logDir: string;
}

export type JobLauncher = (spec: JobSpec) => Promise<JobLaunch>;

export interface JobStore {
  load(): Promise<JobSpec[]>;
  save(specs: JobSpec[]): Promise<void>;
}

export function createFileJobStore(fs: FileStore, sessionDir: () => string): JobStore {
  const path = () => join(sessionDir(), JOBS_FILE);
  return {
    load: async () => {
      if (!(await fs.exists(path()))) return [];
      const data: unknown = JSON.parse(await fs.readText(path()));
      return z.array(jobSpecSchema).parse(data);
    },
    save: async (specs) => {
      await fs.mkdir(sessionDir());
      await fs.writeText(path(), JSON.stringify(specs, null, 2));
    },
  };
}

interface Job {
  info: JobInfo;
  output: string;
  logging: Promise<void>;
  process?: ShellProcess;
  killing?: Promise<void>;
}

function toSpec({ command, level, toolName }: JobSpec): JobSpec {
  return { command, level, toolName };
}

type WaitResult = "matched" | "ended" | "timeout";

function waitResult(job: Job, pattern: RegExp): WaitResult | undefined {
  if (pattern.test(job.output)) return "matched";
  return job.info.status === "running" ? undefined : "ended";
}

export class BackgroundJobs {
  private jobs = new Map<string, Job>();
  private listeners = new Set<JobListener>();
  private interrupted: JobSpec[] = [];
  private restored?: Promise<void>;
  private nextId = 1;

  constructor(
    private readonly shell: Shell,
    private readonly fs: FileStore,
    private readonly launch: JobLauncher,
    private readonly store?: JobStore
  ) {}

  private register(spec: JobSpec, logDir: string): Job {
    const id = `job-${this.nextId++}`;
    const logPath = join(logDir, `${id}.log`);
    const job: Job = {
      info: {
        ...toSpec(spec),
        id,
        status: "running",
        exitCode: null,
        startedAt: Date.now(),
        logPath,
      },
      output: "",
      logging: this.createLog(logDir, logPath),
    };
    this.jobs.set(id, job);
    this.emit({ type: "job_started", job: { ...job.info } });
    return job;
  }

  private async createLog(logDir: string, logPath: string) {
    await this.fs.mkdir(logDir);
    await this.fs.writeText(logPath, "");
  }

  private async appendLog(previous: Promise<void>, logPath: string, text: string) {
    await previous;
    await this.fs.writeText(logPath, text, { append: true });
  }

  private async watch(job: Job, process: ShellProcess) {
    const code = await process.exited;
    this.end(job, job.killing ? "killed" : "exited", code);
    await this.persist();
  }

  private end(job: Job, status: JobStatus, code: number | null) {
    job.info = { ...job.info, status, exitCode: code };
    this.emit({ type: "job_ended", job: { ...job.info } });
  }

  private append(job: Job, text: string) {
    job.output = (job.output + text).slice(-JOB_OUTPUT_LIMIT);
    job.logging = this.appendLog(job.logging, job.info.logPath, text);
    this.emit({ type: "job_output", jobId: job.info.id, text });
  }

  private async persist() {
    if (!this.store) return;
    const running = Array.from(this.jobs.values(), (job) => job.info)
      .filter((info) => info.status === "running")
      .map((info) => toSpec(info));
    await this.store.save([...this.interrupted, ...running]);
  }

  private emit(event: JobEvent) {
    for (const listener of this.listeners) listener(event);
  }

  restore(): Promise<void> {
    this.restored ??= (async () => {
      this.interrupted = (await this.store?.load()) ?? [];
      if (this.interrupted.length > 0)
        this.emit({ type: "jobs_interrupted", specs: this.interrupted });
    })();
    return this.restored;
  }

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): { jobs: JobSnapshot[]; interrupted: JobSpec[] } {
    return {
      jobs: Array.from(this.jobs.values(), (job) => ({
        info: { ...job.info },
        output: job.output,
      })),
      interrupted: [...this.interrupted],
    };
  }

  adopt(
    spec: JobSpec,
    process: ShellProcess,
    output: string,
    logDir: string
  ): { info: JobInfo; append: (text: string) => void } {
    const job = this.register(spec, logDir);
    job.process = process;
    this.append(job, output);
    void this.persist();
    void this.watch(job, process);
    return { info: { ...job.info }, append: (text) => this.append(job, text) };
  }

  async start(spec: JobSpec): Promise<JobInfo> {
    await this.restore();
    const { program, args, cwd, logDir } = await this.launch(spec);
    const job = this.register(spec, logDir);
    try {
      job.process = await this.shell.spawn(program, args, {
        cwd,
        onOutput: (_stream, text) => this.append(job, text),
      });
    } catch (error) {
      this.end(job, "exited", 1);
      throw error;
    }
    await this.persist();
    void this.watch(job, job.process);
    return { ...job.info };
  }

  async restartInterrupted(indices: number[]): Promise<JobInfo[]> {
    await this.restore();
    const specs = this.interrupted.filter((_, index) => indices.includes(index));
    this.interrupted = [];
    this.emit({ type: "jobs_interrupted", specs: [] });
    const started: JobInfo[] = [];
    for (const spec of specs) started.push(await this.start(spec));
    await this.persist();
    return started;
  }

  async dismissInterrupted(): Promise<void> {
    await this.restore();
    this.interrupted = [];
    this.emit({ type: "jobs_interrupted", specs: [] });
    await this.persist();
  }

  read(id: string): JobSnapshot | undefined {
    const job = this.jobs.get(id);
    return job && { info: { ...job.info }, output: job.output };
  }

  async flushLog(id: string): Promise<void> {
    await this.jobs.get(id)?.logging;
  }

  waitFor(id: string, pattern: RegExp, timeoutMs: number): Promise<WaitResult> {
    const job = this.jobs.get(id);
    if (!job) return Promise.resolve("ended");
    return new Promise((resolve) => {
      const immediate = waitResult(job, pattern);
      if (immediate) {
        resolve(immediate);
        return;
      }
      const finish = (result: WaitResult) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      const unsubscribe = this.subscribe((event) => {
        const isThisJob =
          (event.type === "job_output" && event.jobId === id) ||
          (event.type === "job_ended" && event.job.id === id);
        const result = isThisJob ? waitResult(job, pattern) : undefined;
        if (result) finish(result);
      });
    });
  }

  async kill(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job?.process || job.info.status !== "running") return false;
    job.killing ??= terminateProcess(job.process);
    await job.killing;
    return true;
  }

  async dismiss(id: string): Promise<void> {
    await this.kill(id);
    if (this.jobs.delete(id)) this.emit({ type: "job_dismissed", jobId: id });
  }

  async killAll(): Promise<void> {
    await Promise.all(Array.from(this.jobs.keys(), (id) => this.kill(id)));
  }
}
