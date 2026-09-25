import type { ModelOption } from "@/types";

const CUSTOM_MODELS_STORAGE_KEY = "allonomic_custom_models";

export function loadCustomModels(): ModelOption[] {
  try {
    const raw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m): m is ModelOption =>
          Boolean(m) && typeof m.id === "string" && typeof m.label === "string"
      );
    }
  } catch {
    // Ignore localStorage read errors
  }
  return [];
}

export function saveCustomModel(model: ModelOption): void {
  try {
    const existing = loadCustomModels().filter((m) => m.id !== model.id);
    existing.push(model);
    localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Ignore localStorage write errors
  }
}
