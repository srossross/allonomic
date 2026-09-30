import { tool, type StructuredTool } from "@langchain/core/tools";
import { rethrowIfFatal } from "./fatal";
import { z } from "zod";
import type { Runtime } from "../ports";
import { createRejectedResult } from "../userPrompt";
import { resolveSettings } from "../config/settings";
import type { AgentToolOptions } from "./index";
import { isConfirmedByUser } from "./approval";
import { TOOL_SPECS } from "./specs";

export const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

const failureSchema = z.object({ error: z.string().optional() });

const searchResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

const searchSchema = z.object({
  success: z.literal(true),
  data: z.object({ web: z.array(searchResultSchema).default([]) }),
});

const scrapeSchema = z.object({
  success: z.literal(true),
  data: z.object({ markdown: z.string().optional() }),
});

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function createWebTools(
  runtime: Runtime,
  workspaceDir: string,
  options: AgentToolOptions = {}
): StructuredTool[] {
  async function firecrawl<T extends z.ZodTypeAny>(
    endpoint: string,
    json: object,
    schema: T
  ): Promise<z.infer<T>> {
    const { status, body } = await runtime.http.post(`${FIRECRAWL_API}/${endpoint}`, json);
    const parsed = parseJson(body);
    const ok = schema.safeParse(parsed);
    if (status >= 200 && status < 300 && ok.success) return ok.data;
    const failure = failureSchema.safeParse(parsed);
    const reason = failure.success && failure.data.error ? failure.data.error : body.slice(0, 200);
    throw new Error(`HTTP ${status}: ${reason}`);
  }

  async function rejectIfOffline(config: unknown, name: string, label: string) {
    const { networkAccess } = await resolveSettings(runtime, workspaceDir, options.sessionId);
    if (networkAccess) return;
    const prompt = { kind: "confirm" as const, label, detail: "Network access is off" };
    if (!(await isConfirmedByUser(config, prompt))) return createRejectedResult(name, prompt);
  }

  const webSearch = tool(async ({ query, limit }, config) => {
    try {
      const rejected = await rejectIfOffline(
        config,
        TOOL_SPECS.webSearch.name,
        `Search the web: ${query}`
      );
      if (rejected) return rejected;
      const { data } = await firecrawl(
        "search",
        { query, limit: Math.min(Math.max(1, limit), 20) },
        searchSchema
      );
      return data.web.length === 0
        ? `No results for "${query}"`
        : data.web
            .map((r, i) => `${i + 1}. ${r.title ?? r.url}\n${r.url}\n${r.description ?? ""}`)
            .join("\n\n");
    } catch (error: unknown) {
      rethrowIfFatal(error);
      const message = error instanceof Error ? error.message : String(error);
      return `Error searching "${query}": ${message}`;
    }
  }, TOOL_SPECS.webSearch);

  const webFetch = tool(async ({ url }, config) => {
    try {
      const rejected = await rejectIfOffline(config, TOOL_SPECS.webFetch.name, `Fetch ${url}`);
      if (rejected) return rejected;
      const { data } = await firecrawl("scrape", { url, formats: ["markdown"] }, scrapeSchema);
      return data.markdown || `No content returned for ${url}`;
    } catch (error: unknown) {
      rethrowIfFatal(error);
      const message = error instanceof Error ? error.message : String(error);
      return `Error fetching ${url}: ${message}`;
    }
  }, TOOL_SPECS.webFetch);

  return [webSearch, webFetch];
}
