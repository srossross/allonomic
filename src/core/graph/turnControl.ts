import { StopError } from "./stopError";

export interface QueuedPrompt {
  id: string;
  text: string;
}

export class TurnControl {
  private paused = false;
  private queue: QueuedPrompt[] = [];
  private resumers: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const resumers = this.resumers;
    this.resumers = [];
    for (const resume of resumers) resume();
  }

  enqueue(prompt: QueuedPrompt): void {
    this.queue.push(prompt);
  }

  remove(id: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((p) => p.id !== id);
    return this.queue.length < before;
  }

  drain(): QueuedPrompt[] {
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  async waitWhilePaused(signal?: AbortSignal): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new StopError());
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.resumers.push(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }
}

export class TurnControls {
  private controls = new Map<string, TurnControl>();

  start(threadId: string): TurnControl {
    const control = new TurnControl();
    this.controls.set(threadId, control);
    return control;
  }

  end(threadId: string, control?: TurnControl): void {
    if (this.controls.get(threadId) === control) this.controls.delete(threadId);
  }

  pause(threadId: string): void {
    this.controls.get(threadId)?.pause();
  }

  resume(threadId: string): void {
    this.controls.get(threadId)?.resume();
  }

  enqueue(threadId: string, prompt: QueuedPrompt): void {
    this.controls.get(threadId)?.enqueue(prompt);
  }

  dequeue(threadId: string, id: string): boolean {
    return this.controls.get(threadId)?.remove(id) ?? false;
  }
}
