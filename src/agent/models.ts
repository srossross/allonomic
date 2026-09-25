import type { ModelOption } from "@/types";
import { findApiKey } from "../common/env";

export const DEFAULT_MODEL_ID = "gemini-3.8-flash";

export const FALLBACK_MODELS: ModelOption[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", hasThinking: true },
  { id: "gemini-3.8-pro", label: "Gemini 3.8 Pro", hasThinking: true },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hasThinking: true },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hasThinking: true },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hasThinking: true },
];

interface RawModelEntry {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedGenerationMethods?: unknown;
}

function getModelPriorityScore(id: string): number {
  let score = 0;
  if (id.includes("3.8")) score += 3000;
  else if (id.includes("2.5")) score += 2000;
  else if (id.includes("2.0")) score += 1000;

  if (id.includes("flash")) score += 100;
  if (id.includes("pro")) score += 50;
  if (id.includes("lite")) score -= 10;
  if (id.includes("exp")) score -= 5;
  return score;
}

/**
 * Fetches available models dynamically from the Google Generative Language API.
 * Falls back to curated Gemini models if offline, unauthenticated, or rate-limited.
 */
export async function fetchAvailableModels(apiKey?: string): Promise<ModelOption[]> {
  const key = apiKey || findApiKey();
  if (!key) {
    return FALLBACK_MODELS;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      {
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Models] Gemini API returned status ${res.status}, falling back to defaults`);
      return FALLBACK_MODELS;
    }

    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || !("models" in data) || !Array.isArray(data.models)) {
      return FALLBACK_MODELS;
    }

    const validEntries: RawModelEntry[] = data.models.filter(
      (m): m is RawModelEntry => typeof m === "object" && m !== null
    );

    const geminiModels = validEntries.filter((m) => {
      const name = typeof m.name === "string" ? m.name.toLowerCase() : "";
      const methods = Array.isArray(m.supportedGenerationMethods)
        ? m.supportedGenerationMethods
        : [];
      const isGenerateContent = methods.includes("generateContent");

      return (
        isGenerateContent &&
        name.includes("gemini") &&
        !name.includes("embedding") &&
        !name.includes("aqa")
      );
    });

    if (geminiModels.length === 0) {
      return FALLBACK_MODELS;
    }

    const parsed: ModelOption[] = geminiModels.map((m) => {
      const rawName = typeof m.name === "string" ? m.name : "";
      const cleanId = rawName.replace(/^models\//, "");
      const label = typeof m.displayName === "string" && m.displayName ? m.displayName : cleanId;
      const lower = cleanId.toLowerCase();
      const hasThinking =
        lower.includes("3.8") ||
        lower.includes("2.5") ||
        lower.includes("2.0") ||
        lower.includes("thinking") ||
        lower.includes("flash") ||
        lower.includes("pro");

      return {
        id: cleanId,
        label,
        hasThinking,
      };
    });

    // Custom sorting: Prioritize 3.8 > 2.5 > 2.0, with flash before pro
    parsed.sort((a, b) => {
      const scoreA = getModelPriorityScore(a.id);
      const scoreB = getModelPriorityScore(b.id);
      return scoreA === scoreB ? a.label.localeCompare(b.label) : scoreB - scoreA;
    });

    return parsed;
  } catch (error) {
    console.warn("[Models] Failed to fetch dynamic models from Gemini API:", error);
    return FALLBACK_MODELS;
  }
}
