import { describe, it, expect } from "bun:test";
import {
  createPendingResult,
  createRejectedResult,
  createResponseResult,
  decodeToolResult,
  isPendingToolResult,
} from "../src/core/userPrompt";
import type { UserPrompt } from "../src/types";

const prompts: UserPrompt[] = [
  { kind: "confirm", label: "go mod tidy" },
  { kind: "confirm", label: "Write a.txt", detail: "12 bytes" },
  {
    kind: "choice",
    label: "Branch?",
    options: [
      { value: "main", label: "main" },
      { value: "dev", label: "dev" },
    ],
  },
  { kind: "text", label: "Commit message", placeholder: "feat: ..." },
];

describe("userPrompt encoding", () => {
  it("round-trips every prompt kind", () => {
    for (const prompt of prompts) {
      expect(decodeToolResult(createPendingResult(prompt))).toEqual({ status: "pending", prompt });
      expect(isPendingToolResult(createPendingResult(prompt))).toBe(true);
    }
  });

  it("decodes rejection results", () => {
    const r = createRejectedResult("write_file", prompts[1]);
    expect(decodeToolResult(r)).toEqual({ status: "rejected" });
    expect(r).toContain("Write a.txt");
    expect(r).toContain("write_file");
  });

  it("treats everything else as executed", () => {
    for (const c of [
      "",
      "ok",
      "[PENDING_APPROVAL]: legacy",
      "{not json",
      '{"pending":false}',
      '{"pending":true}',
      '{"pending":true,"prompt":{"kind":"nope","label":"x"}}',
      '{"pending":true,"prompt":{"kind":"choice","label":"x","options":["a"]}}',
      42,
      null,
      undefined,
      ["x"],
    ]) {
      expect(decodeToolResult(c)).toEqual({ status: "executed" });
    }
    expect(decodeToolResult(createResponseResult(prompts[3], "hi"))).toEqual({
      status: "executed",
    });
  });
});
