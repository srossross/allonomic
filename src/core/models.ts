import YAML from "yaml";
import { z } from "zod";
import type { Runtime } from "./ports";
import { join } from "./paths";
import { THINKING_LEVELS, type ModelOption } from "../types/chat";

const modelEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  thinking: z.array(z.enum(THINKING_LEVELS)),
  input_token_limit: z.number().int().positive(),
  price_per_million: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      long_input: z.number().nonnegative().optional(),
      long_output: z.number().nonnegative().optional(),
    })
    .optional(),
});

const modelsFileSchema = z.object({ models: z.array(modelEntrySchema) });

const workspaceModelsSchema = z.object({ models: z.array(modelEntrySchema).optional() });

function toModelOption(entry: z.infer<typeof modelEntrySchema>): ModelOption {
  return {
    id: entry.id,
    label: entry.label,
    thinking: entry.thinking,
    inputTokenLimit: entry.input_token_limit,
    price: entry.price_per_million && {
      input: entry.price_per_million.input,
      output: entry.price_per_million.output,
      longInput: entry.price_per_million.long_input ?? entry.price_per_million.input,
      longOutput: entry.price_per_million.long_output ?? entry.price_per_million.output,
    },
  };
}

async function parseYamlFile<T>(runtime: Runtime, path: string, schema: z.ZodType<T>): Promise<T> {
  const result = schema.safeParse(YAML.parse(await runtime.fs.readText(path)) ?? {});
  if (!result.success) throw new Error(`Invalid models in ${path}: ${result.error.message}`);
  return result.data;
}

export async function loadModels(runtime: Runtime, workspaceDir?: string): Promise<ModelOption[]> {
  const basePath = await runtime.paths.resource("app-data/models.yml");
  const base = await parseYamlFile(runtime, basePath, modelsFileSchema);
  const result = base.models.map((m) => toModelOption(m));

  if (workspaceDir) {
    const workspacePath = join(workspaceDir, ".allonomic", "workspace.yml");
    if (await runtime.fs.exists(workspacePath)) {
      const { models = [] } = await parseYamlFile(runtime, workspacePath, workspaceModelsSchema);
      for (const entry of models) {
        const model = toModelOption(entry);
        const index = result.findIndex((m) => m.id === model.id);
        if (index === -1) result.push(model);
        else result[index] = model;
      }
    }
  }

  return result;
}
