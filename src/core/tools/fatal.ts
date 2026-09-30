import { ConfigError } from "../config/settings";
import { StopError } from "../graph/stopError";

export function rethrowIfFatal(error: unknown): void {
  if (error instanceof StopError || error instanceof ConfigError) throw error;
}
