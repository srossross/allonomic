export function alertError(action: string) {
  return (error: unknown) => {
    console.error(`[${action}]`, error);
    globalThis.alert(`${action} failed: ${error instanceof Error ? error.message : String(error)}`);
  };
}

export async function withAlert(action: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    alertError(action)(error);
  }
}
