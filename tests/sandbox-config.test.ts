import { describe, it, expect } from "bun:test";
import {
  DEFAULT_SANDBOX_CONFIG,
  parseSandboxConfig,
  sandboxRules,
} from "../src/core/tools/sandboxConfig";

const variables = { project: "/p", tmp: "/t", home: "/h" };

describe("sandbox config", () => {
  it("defaults each missing field", () => {
    const config = parseSandboxConfig("sandbox:\n  2:\n    write: [~/.foo]\n");
    expect(config.deny).toEqual(DEFAULT_SANDBOX_CONFIG.deny);
    expect(config.tiers[1]).toEqual(DEFAULT_SANDBOX_CONFIG.tiers[1]);
    expect(config.tiers[2]).toEqual({
      read: DEFAULT_SANDBOX_CONFIG.tiers[2].read,
      write: ["~/.foo"],
    });
  });

  it("each level includes everything allowed in lower levels", () => {
    const config = DEFAULT_SANDBOX_CONFIG;
    const level1 = sandboxRules(config, 1, variables);
    const level3 = sandboxRules(config, 3, variables);
    for (const path of level1.read) expect(level3.read).toContain(path);
    for (const path of level1.write) expect(level3.write).toContain(path);
    expect(level3.write).toContain("/p");
  });

  it("expands $PROJECT, $TMP and ~", () => {
    const config = parseSandboxConfig(
      "sandbox:\n  deny: [$PROJECT/.x]\n  1:\n    read: [$PROJECT, ~/a, '~']\n    write: [$TMP/]\n"
    );
    expect(sandboxRules(config, 1, variables)).toEqual({
      read: ["/p", "/h/a", "/h"],
      write: ["/t"],
      deny: ["/p/.x"],
    });
  });
});
