import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { createNodeRuntime } from "../src/adapters/node/runtime";

const { shell } = createNodeRuntime();

function groupAlive(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("node shell supervision", () => {
  it("runs in cwd", async () => {
    const cwd = realpathSync(tmpdir());
    const result = await shell.execute("sh", ["-c", "pwd"], { cwd });
    expect(result).toEqual({ code: 0, stdout: `${cwd}\n`, stderr: "", termination: undefined });
  });

  it("times out a backgrounded process holding the pipes and kills its group", async () => {
    const start = performance.now();
    const result = await shell.execute("sh", ["-c", "echo started; echo $$; sleep 30 &"], {
      timeoutMs: 300,
    });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(result.termination).toBe("timeout");
    expect(result.code).toBeNull();
    const [first, pid] = result.stdout.trim().split("\n", 2);
    expect(first).toBe("started");
    await Bun.sleep(100);
    expect(groupAlive(Number(pid))).toBe(false);
  });

  it("stops on abort and keeps partial output", async () => {
    const controller = new AbortController();
    const pending = shell.execute("sh", ["-c", "echo partial; sleep 30"], {
      signal: controller.signal,
    });
    await Bun.sleep(200);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ code: null, stdout: "partial\n", termination: "stopped" });
  });
});
