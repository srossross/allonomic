export interface ReframeOptions {
  apiKey?: string;
  modelName?: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

const PROMPT = `Reframe the given user intent into a satisfaction condition of 10 words or less for display in a UI.

Rules:
1. Maximum 10 words.
2. Phrased as a concise condition describing the satisfied state (e.g. "String is appended to foo.txt", "Answer is provided for...", "File is updated").
3. Output ONLY the raw condition string. No quotes, no markdown wrappers, no extra commentary.

Examples:
Input: User wants to append the string "asdf" to the file "foo.txt".
Output: String is appended to foo.txt

Input: User wants to know if the agent is capable of running \`ls\`.
Output: Answer if the agent is capable of running \`ls\` command
`;

function extractRawContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (typeof first === "object" && first !== null && "text" in first) {
      const text = Reflect.get(first, "text");
      if (typeof text === "string") {
        return text;
      }
    }
  }
  return "";
}

export async function reframeSatisfaction(
  intentDescription: string,
  options: ReframeOptions = {}
): Promise<string> {
  // If running in browser / WebView: delegate to server endpoint to keep client bundle clean
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/agent/reframe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: intentDescription, options }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.condition) {
          return data.condition;
        }
      }
    } catch {
      // Fallback on network failure
    }
    return intentDescription;
  }

  // If running on server / Node.js:
  // Using dynamic import with @vite-ignore to prevent Vite from bundling Node.js modules for the browser
  const { ChatGoogleGenerativeAI } = await import(/* @vite-ignore */ "@langchain/google-genai");
  const { findApiKey } = await import(/* @vite-ignore */ "../common/env");

  const apiKey = options.apiKey || findApiKey();
  if (!apiKey) {
    throw new Error("Missing Gemini API key for reframeSatisfaction");
  }

  const model = new ChatGoogleGenerativeAI({
    model: options.modelName ?? DEFAULT_MODEL,
    apiKey,
    temperature: 0,
  });

  const response = await model.invoke([
    { role: "system", content: PROMPT },
    { role: "user", content: `Input: ${intentDescription}\nOutput:` },
  ]);

  const raw = extractRawContentText(response.content);

  return raw
    .trim()
    .replaceAll(/^["'`]|["'`]$/g, "")
    .trim();
}
