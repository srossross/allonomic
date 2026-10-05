import { describe, it, expect } from "bun:test";
import { schemaToGenerativeAIParameters } from "../node_modules/@langchain/google-genai/dist/utils/zod_to_genai_parameters.js";
import { TOOL_SPECS } from "../src/core/tools/specs";

const UNSUPPORTED = new Set(["exclusiveMinimum", "exclusiveMaximum"]);

function unsupportedKeys(value: unknown, path: string): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(UNSUPPORTED.has(key) ? [`${path}.${key}`] : []),
    ...unsupportedKeys(child, `${path}.${key}`),
  ]);
}

describe("tool specs sent to Gemini", () => {
  it("use no schema keys Gemini rejects", () => {
    const found = Object.values(TOOL_SPECS).flatMap((spec) =>
      unsupportedKeys(schemaToGenerativeAIParameters(spec.schema), spec.name)
    );
    expect(found).toEqual([]);
  });
});
