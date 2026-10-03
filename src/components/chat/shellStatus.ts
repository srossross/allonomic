import type { ToolCallInfo } from "@/types";
import { parseShellResult, type ParsedShellResult } from "@/core/tools/shellResult";

export function shellResult(tc: ToolCallInfo): ParsedShellResult | undefined {
  return typeof tc.result === "string" ? parseShellResult(tc.result) : undefined;
}

export function isShellFailure(parsed: ParsedShellResult | undefined) {
  if (!parsed) return false;
  return parsed.exitCode === undefined
    ? parsed.output.startsWith("Error executing command")
    : parsed.exitCode !== 0 && parsed.exitCode !== "background";
}

export function shellCallFailed(tc: ToolCallInfo) {
  return tc.status === "executed" && isShellFailure(shellResult(tc));
}
