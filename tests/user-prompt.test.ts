import { describe, it, expect } from "bun:test";
import { createRejectedResult, decodeToolResult } from "../src/core/userPrompt";

describe("userPrompt encoding", () => {
  it("decodes rejection results", () => {
    const r = createRejectedResult("write_file", { kind: "confirm", label: "Write a.txt" });
    expect(decodeToolResult(r)).toEqual({ status: "rejected" });
    expect(r).toContain("Write a.txt");
    expect(r).toContain("write_file");
  });

  it("treats everything else as executed", () => {
    for (const c of ["", "ok", '{"pending":true}', 42, null, undefined, ["x"]]) {
      expect(decodeToolResult(c)).toEqual({ status: "executed" });
    }
  });
});
