export function findApiKey(): string | undefined {
  return process.env.API_KEY || undefined;
}
