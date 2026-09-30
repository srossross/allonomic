export class StopError extends Error {
  override name = "AbortError";

  constructor() {
    super("Generation stopped by user");
  }
}
