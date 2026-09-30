import { tool, type StructuredTool } from "@langchain/core/tools";
import type { z } from "zod";
import type { Runtime } from "../ports";
import { LEVEL_MODES, type ExecutionMode, type UserPrompt } from "@/types";
import { createRejectedResult } from "../userPrompt";
import {
  applyPermissionChange,
  type PermissionChange,
  type PermissionScope,
} from "../config/permissions";
import type { AgentToolOptions } from "./index";
import { askUserFromTool } from "./approval";
import {
  SANDBOX_LEVELS,
  expand,
  sandboxVariables,
  type SandboxLevel,
  type SandboxVariables,
} from "./sandboxConfig";
import { TOOL_SPECS } from "./specs";

type PermissionInput = z.infer<typeof TOOL_SPECS.modifySandboxPermissions.schema>;

const PATH_PREFIX = /^(\/|~(?=\/|$)|\$PROJECT(?=\/|$)|\$TMP(?=\/|$))/;

const SCOPE_LABELS: Record<PermissionScope, string> = {
  session: "this session",
  project: "this project",
  global: "all projects",
};

const SCOPES: ReadonlySet<unknown> = new Set(Object.keys(SCOPE_LABELS));
const LEVELS: ReadonlySet<unknown> = new Set(SANDBOX_LEVELS);

function isSandboxLevel(value: unknown): value is SandboxLevel {
  return LEVELS.has(value);
}

function toChange({ op, path, level }: PermissionInput): PermissionChange | string {
  if (op === "network_on" || op === "network_off") {
    return path === undefined && level === undefined
      ? { op }
      : `Error: ${op} takes no path or level`;
  }
  if (!path) return `Error: ${op} requires a path`;
  if (!PATH_PREFIX.test(path)) return `Error: path must start with /, ~, $PROJECT or $TMP: ${path}`;
  if (op === "deny") return level === undefined ? { op, path } : "Error: deny takes no level";
  return isSandboxLevel(level) ? { op, path, level } : `Error: ${op} requires level 1, 2 or 3`;
}

interface ChangeDescription {
  headline: string;
  mode?: ExecutionMode;
  expandedPath?: string;
}

function describeChange(change: PermissionChange, variables: SandboxVariables): ChangeDescription {
  if (change.op === "network_on") return { headline: "Turn network on for sandboxed shells" };
  if (change.op === "network_off") return { headline: "Turn network off for sandboxed shells" };
  const expanded = expand(change.path, variables);
  const expandedPath = expanded === change.path ? undefined : expanded;
  if (change.op === "deny") return { headline: `Deny ${change.path} in all modes`, expandedPath };
  const mode = LEVEL_MODES[change.level];
  const access = change.op === "allow_read" ? "read of" : "write to";
  return { headline: `Allow ${access} ${change.path} in ${mode} mode`, mode, expandedPath };
}

function isScope(value: unknown): value is PermissionScope {
  return SCOPES.has(value);
}

export function createPermissionTools(
  runtime: Runtime,
  workspaceDir: string,
  options: AgentToolOptions = {}
): StructuredTool[] {
  const spec = TOOL_SPECS.modifySandboxPermissions;

  const modifySandboxPermissions = tool(async (input: PermissionInput, config) => {
    const change = toChange(input);
    if (typeof change === "string") return change;
    const { headline, mode, expandedPath } = describeChange(
      change,
      await sandboxVariables(runtime, workspaceDir)
    );
    const prompt: UserPrompt = {
      kind: "choice",
      label: headline,
      detail: expandedPath ? `${expandedPath}\n${input.reason}` : input.reason,
      mode,
      options: [
        { value: "deny", label: "Deny" },
        ...(options.sessionId ? [{ value: "session", label: "This session" }] : []),
        { value: "project", label: "This project" },
        { value: "global", label: "Global" },
      ],
    };
    const scope = await askUserFromTool(config, prompt);
    if (!isScope(scope)) return createRejectedResult(spec.name, prompt);
    await applyPermissionChange(runtime, workspaceDir, options.sessionId, scope, change);
    return `Applied for ${SCOPE_LABELS[scope]}: ${headline}`;
  }, spec);

  return [modifySandboxPermissions];
}
