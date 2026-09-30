import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { findApiKey } from "../../common/env";

const TITLE_MODEL_ID = "gemini-3.5-flash-lite";

const PROMPT = `Write a short title (at most 6 words) for a chat that starts with the user message below.
Output ONLY the title. No quotes, no markdown, no trailing punctuation.`;

export async function generateChatTitle(prompt: string): Promise<string> {
  const apiKey = findApiKey();
  if (!apiKey) throw new Error("Missing Gemini API key for chat title");

  const model = new ChatGoogleGenerativeAI({ model: TITLE_MODEL_ID, apiKey, temperature: 0 });
  const response = await model.invoke([
    { role: "system", content: PROMPT },
    { role: "user", content: prompt },
  ]);

  const title = response.text
    .trim()
    .replaceAll(/^["'`]+|["'`.]+$/g, "")
    .trim();
  if (!title) throw new Error("Chat title model returned no text");
  return title;
}
