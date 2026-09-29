import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createMemoryRuntime } from "../src/adapters/memory/runtime";
import { loadModels } from "../src/core/models";

const BASE = "/resources/app-data/models.yml";
const WORKSPACE = "/ws/.allonomic/workspace.yml";

function runtimeWith(files: Record<string, string>) {
  const runtime = createMemoryRuntime();
  for (const [path, content] of Object.entries(files)) runtime.fs.files.set(path, content);
  return runtime;
}

const base = `models:
  - { id: a, label: A, thinking: [Off, Low], input_token_limit: 100 }
  - { id: b, label: B, thinking: [], input_token_limit: 200 }
`;

describe("loadModels", () => {
  it("parses the bundled app-data/models.yml", async () => {
    const runtime = runtimeWith({ [BASE]: readFileSync("app-data/models.yml", "utf8") });
    const models = await loadModels(runtime);
    expect(models.map((m) => m.id)).toContain("gemini-3.8-flash");
    expect(models.every((m) => m.inputTokenLimit > 0)).toBe(true);
  });

  it("maps yaml fields to ModelOption", async () => {
    const models = await loadModels(runtimeWith({ [BASE]: base }));
    expect(models).toEqual([
      { id: "a", label: "A", thinking: ["Off", "Low"], inputTokenLimit: 100 },
      { id: "b", label: "B", thinking: [], inputTokenLimit: 200 },
    ]);
  });

  it("workspace models override by id and append new ids", async () => {
    const workspace = `active_tab_id: x
models:
  - { id: b, label: B2, thinking: [High], input_token_limit: 999 }
  - { id: c, label: C, thinking: [], input_token_limit: 300 }
`;
    const models = await loadModels(runtimeWith({ [BASE]: base, [WORKSPACE]: workspace }), "/ws");
    expect(models.map((m) => [m.id, m.label, m.inputTokenLimit])).toEqual([
      ["a", "A", 100],
      ["b", "B2", 999],
      ["c", "C", 300],
    ]);
  });

  it("workspace.yml without models leaves the base list", async () => {
    const models = await loadModels(
      runtimeWith({ [BASE]: base, [WORKSPACE]: "active_tab_id: x\n" }),
      "/ws"
    );
    expect(models.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("throws on an invalid entry", async () => {
    const bad = "models:\n  - { id: a, label: A, thinking: [Low] }\n";
    await expect(loadModels(runtimeWith({ [BASE]: bad }))).rejects.toThrow(/Invalid models/);
  });
});
