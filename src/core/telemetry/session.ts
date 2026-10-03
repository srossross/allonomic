export function generateSessionId(size: number = 8): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let index = 0; index < size; index++) {
    id += alphabet[bytes[index] % alphabet.length];
  }
  return id;
}
