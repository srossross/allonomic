import { describe, it, expect } from "bun:test";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";
import { loadUserConfig, resolveSettings } from "../src/core/config/settings";
import { decodeToolResult } from "../src/core/userPrompt";
import type { ExecutionMode, UserPrompt, UserPromptValue } from "../src/types";
import { recordingContext } from "./helpers/turnContext";

function permissionTool(answer: UserPromptValue, mode: ExecutionMode = "restricted") {
  const runtime = createMemoryRuntime();
  const prompts: UserPrompt[] = [];
  const { context } = recordingContext("t1", 1, async (prompt) => {
    prompts.push(prompt);
    return answer;
  });
  const tools = createAgentTools(runtime, "/w", mode, { sessionId: "s1" });
  const target = tools.find((t) => t.name === "modify_sandbox_permissions")!;
  const invoke = (args: Record<string, unknown>) =>
    target.invoke({ reason: "npm needs it", ...args }, { configurable: { context } });
  return { runtime, prompts, invoke };
}

const NPMRC = { op: "allow_write", path: "~/.npmrc", level: 2 };

describe("modify_sandbox_permissions", () => {
  it("shows the change with the expanded path and the scope choices", async () => {
    const { prompts, invoke } = permissionTool("deny");
    await invoke(NPMRC);
    expect(prompts).toEqual([
      {
        kind: "choice",
        label: "Allow write to ~/.npmrc in read mode",
        detail: "/home/test/.npmrc\nnpm needs it",
        mode: "read",
        options: [
          { value: "deny", label: "Deny" },
          { value: "session", label: "This session" },
          { value: "project", label: "This project" },
          { value: "global", label: "Global" },
        ],
      },
    ]);
  });

  it("omits the expanded path when it matches, and names network changes", async () => {
    const { prompts, invoke } = permissionTool("deny");
    await invoke({ op: "allow_read", path: "/opt/homebrew", level: 1 });
    await invoke({ op: "network_on" });
    expect(prompts.map((p) => [p.label, "detail" in p ? p.detail : undefined])).toEqual([
      ["Allow read of /opt/homebrew in restricted mode", "npm needs it"],
      ["Turn network on for sandboxed shells", "npm needs it"],
    ]);
  });

  it("deny writes nothing", async () => {
    const { runtime, invoke } = permissionTool("deny");
    await loadUserConfig(runtime);
    const before = runtime.fs.files.get("/appconfig/config.yml");
    const result = await invoke(NPMRC);
    expect(decodeToolResult(result)).toEqual({ status: "rejected" });
    expect(runtime.fs.files.get("/appconfig/config.yml")).toBe(before);
  });

  it("session scope applies only to this session", async () => {
    const { runtime, invoke } = permissionTool("session");
    expect(await invoke(NPMRC)).toContain("Applied for this session");
    const session = await resolveSettings(runtime, "/w", "s1");
    const other = await resolveSettings(runtime, "/w", "s2");
    expect(session.sandbox.tiers[2].write).toContain("~/.npmrc");
    expect(other.sandbox.tiers[2].write).not.toContain("~/.npmrc");
  });

  it("project scope applies to every session in the project only", async () => {
    const { runtime, invoke } = permissionTool("project");
    await invoke(NPMRC);
    const otherSession = await resolveSettings(runtime, "/w", "s2");
    const otherProject = await resolveSettings(runtime, "/other", "s1");
    expect(otherSession.sandbox.tiers[2].write).toContain("~/.npmrc");
    expect(otherProject.sandbox.tiers[2].write).not.toContain("~/.npmrc");
  });

  it("global scope applies everywhere and keeps the defaults", async () => {
    const { runtime, invoke } = permissionTool("global");
    await invoke(NPMRC);
    await invoke({ op: "deny", path: "$PROJECT/.env" });
    const settings = await resolveSettings(runtime, "/other");
    expect(settings.sandbox.tiers[2].write).toContain("~/.npmrc");
    expect(settings.sandbox.tiers[2].write).toContain("~/.npm");
    expect(settings.sandbox.deny).toEqual(["$PROJECT/.allonomic", "$PROJECT/.env"]);
  });

  it("network changes set network access for the chosen scope", async () => {
    const { runtime, invoke } = permissionTool("session");
    await invoke({ op: "network_on" });
    const session = await resolveSettings(runtime, "/w", "s1");
    expect(session.networkAccess).toBe(true);
  });

  it("asks even in god mode", async () => {
    const { prompts, invoke } = permissionTool("deny", "god");
    await invoke({ op: "network_on" });
    expect(prompts).toHaveLength(1);
  });

  it("rejects invalid input without asking", async () => {
    const { prompts, invoke } = permissionTool("session");
    const errors = [
      await invoke({ op: "allow_read", path: "relative/x", level: 1 }),
      await invoke({ op: "allow_read", path: "/x" }),
      await invoke({ op: "allow_read", path: "/x", level: 4 }),
      await invoke({ op: "deny" }),
      await invoke({ op: "deny", path: "/x", level: 1 }),
      await invoke({ op: "network_on", path: "/x" }),
    ];
    for (const error of errors) expect(error).toStartWith("Error:");
    expect(prompts).toHaveLength(0);
  });
});
