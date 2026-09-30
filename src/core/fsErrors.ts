const NOT_FOUND_MARKERS = ["No such file", "os error 2", "system cannot find the path", "ENOENT"];

export function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NOT_FOUND_MARKERS.some((marker) => message.includes(marker));
}
