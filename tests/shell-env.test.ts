import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { createMemoryRuntime, ScriptedShell } from "../src/adapters/memory/runtime";
import { createAgentTools } from "../src/core/tools";

async function setup(userConfig: Record<string, unknown> = {}) {
  const runtime = createMemoryRuntime();
  const shell = new ScriptedShell();
  runtime.shell = shell;
  await runtime.fs.writeText(
    "/resources/app-data/env-defaults.yml",
    readFileSync("app-data/env-defaults.yml", "utf8")
  );
  await runtime.fs.writeText("/appconfig/config.yml", YAML.stringify(userConfig));
  const tools = createAgentTools(runtime, "/w", "god");
  const run = async (name: string) => {
    await tools.find((t) => t.name === name)!.invoke({ command: "git grep x" });
    return shell.spawned.at(-1)!;
  };
  return { run };
}

describe("shell env defaults", () => {
  it("applies app-data env defaults to sandboxed and full-access shells", async () => {
    const { run } = await setup();
    for (const name of ["shell_1_project_read_only", "shell_4_full_access"]) {
      const { env } = await run(name);
      expect(env).toMatchObject({
        NO_COLOR: "1",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "color.ui",
        GIT_CONFIG_VALUE_0: "never",
        PAGER: "cat",
      });
    }
  });

  it("lets the user config override and add variables", async () => {
    const { run } = await setup({ shell_env: { PAGER: "less", EXTRA: "1" } });
    const { env } = await run("shell_4_full_access");
    expect(env).toMatchObject({ PAGER: "less", EXTRA: "1", NO_COLOR: "1" });
  });
});
