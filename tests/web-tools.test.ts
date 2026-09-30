import { describe, it, expect } from "bun:test";
import { createMemoryRuntime, ScriptedHttp } from "../src/adapters/memory/runtime";
import { createAgentTools, FIRECRAWL_API } from "../src/core/tools";
import { decodeToolResult } from "../src/core/userPrompt";
import type { UserPrompt, UserPromptValue } from "../src/types";
import { recordingContext } from "./helpers/turnContext";

function webTools(
  response: { status?: number; json: unknown },
  options: { network?: boolean; answer?: UserPromptValue } = {}
) {
  const runtime = createMemoryRuntime();
  runtime.http = new ScriptedHttp(() => ({
    status: response.status ?? 200,
    body: JSON.stringify(response.json),
  }));
  if (options.network ?? true)
    runtime.fs.files.set("/appconfig/config.yml", "network_access: true\n");
  const prompts: UserPrompt[] = [];
  const { context } = recordingContext("t1", 1, async (prompt) => {
    prompts.push(prompt);
    return options.answer ?? false;
  });
  const config = { configurable: { context } };
  const tools = createAgentTools(runtime, "/w", "god");
  const invoker = (name: string) => {
    const t = tools.find((candidate) => candidate.name === name)!;
    return (args: Record<string, unknown>) => t.invoke(args, config);
  };
  return {
    http: runtime.http,
    prompts,
    search: invoker("web_search"),
    fetchPage: invoker("web_fetch"),
  };
}

describe("web tools", () => {
  it("web_search posts the query and formats results", async () => {
    const { http, search } = webTools({
      json: {
        success: true,
        data: {
          web: [
            { title: "A", url: "https://a.com", description: "alpha" },
            { url: "https://b.com" },
          ],
        },
      },
    });
    const result = await search({ query: "node lts", limit: 50 });
    expect(http.calls).toEqual([
      { url: `${FIRECRAWL_API}/search`, json: { query: "node lts", limit: 20 } },
    ]);
    expect(result).toBe("1. A\nhttps://a.com\nalpha\n\n2. https://b.com\nhttps://b.com\n");
  });

  it("web_search reports no results", async () => {
    const { search } = webTools({ json: { success: true, data: { web: [] } } });
    expect(await search({ query: "zzz" })).toBe('No results for "zzz"');
  });

  it("web_fetch posts the url and returns markdown", async () => {
    const { http, fetchPage } = webTools({
      json: { success: true, data: { markdown: "# Title" } },
    });
    expect(await fetchPage({ url: "https://a.com" })).toBe("# Title");
    expect(http.calls).toEqual([
      { url: `${FIRECRAWL_API}/scrape`, json: { url: "https://a.com", formats: ["markdown"] } },
    ]);
  });

  it("returns HTTP errors as strings", async () => {
    const { fetchPage } = webTools({
      status: 429,
      json: { success: false, error: "Rate limit exceeded" },
    });
    expect(await fetchPage({ url: "https://a.com" })).toBe(
      "Error fetching https://a.com: HTTP 429: Rate limit exceeded"
    );
  });

  it("returns success: false as an error string", async () => {
    const { search } = webTools({ json: { success: false, error: "bad query" } });
    expect(await search({ query: "q" })).toBe('Error searching "q": HTTP 200: bad query');
  });

  it("asks when network access is off and does not fetch if declined", async () => {
    const { http, fetchPage, prompts } = webTools(
      { json: { success: true, data: { markdown: "x" } } },
      { network: false, answer: false }
    );
    const result = await fetchPage({ url: "https://a.com" });
    expect(decodeToolResult(result)).toEqual({ status: "rejected" });
    expect(prompts).toEqual([
      { kind: "confirm", label: "Fetch https://a.com", detail: "Network access is off" },
    ]);
    expect(http.calls).toHaveLength(0);
  });

  it("runs when network access is off and the user accepts", async () => {
    const { http, fetchPage } = webTools(
      { json: { success: true, data: { markdown: "x" } } },
      { network: false, answer: true }
    );
    expect(await fetchPage({ url: "https://a.com" })).toBe("x");
    expect(http.calls).toHaveLength(1);
  });

  it("does not ask when network access is on", async () => {
    const { fetchPage, prompts } = webTools({ json: { success: true, data: { markdown: "x" } } });
    await fetchPage({ url: "https://a.com" });
    expect(prompts).toHaveLength(0);
  });
});
