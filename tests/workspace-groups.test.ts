import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  parseGroups,
  readGroupId,
  removeGroup,
  serializeGroups,
} from "../src/persistence/workspaceGroups";
import type { WorkspacesConfig } from "../src/types/persistence";

describe("workspace groups", () => {
  test("round-trips through YAML", () => {
    const groups = [
      { id: "g-1", name: "Work", color: "blue" as const, collapsed: true },
      { id: "g-2", name: "Play", color: "pink" as const },
    ];
    const yml = YAML.stringify(serializeGroups(groups));
    expect(parseGroups(YAML.parse(yml))).toEqual(groups);
  });

  test("drops entries with unknown color or missing fields", () => {
    const parsed = parseGroups([
      { id: "g-1", name: "Ok", color: "green" },
      { id: "g-2", name: "Bad", color: "#ff0000" },
      { id: "g-3", color: "red" },
      { name: "NoId", color: "red" },
      "junk",
    ]);
    expect(parsed.map((g) => g.id)).toEqual(["g-1"]);
  });

  test("non-array groups parse to empty", () => {
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups({ id: "g-1" })).toEqual([]);
  });

  test("readGroupId ignores references to missing groups", () => {
    const groups = parseGroups([{ id: "g-1", name: "A", color: "red" }]);
    expect(readGroupId({ group: "g-1" }, groups)).toBe("g-1");
    expect(readGroupId({ group: "g-missing" }, groups)).toBeUndefined();
    expect(readGroupId({}, groups)).toBeUndefined();
  });

  test("removeGroup ungroups its members only", () => {
    const config: WorkspacesConfig = {
      groups: [
        { id: "g-1", name: "A", color: "red" },
        { id: "g-2", name: "B", color: "blue" },
      ],
      workspaces: [
        { id: "/a", name: "a", path: "/a", groupId: "g-1" },
        { id: "/b", name: "b", path: "/b", groupId: "g-2" },
        { id: "/c", name: "c", path: "/c" },
      ],
    };
    removeGroup(config, "g-1");
    expect(config.groups.map((g) => g.id)).toEqual(["g-2"]);
    expect(config.workspaces.map((w) => w.groupId)).toEqual([undefined, "g-2", undefined]);
  });
});
