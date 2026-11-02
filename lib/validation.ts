export const MAX_MESSAGE = 140;
export const MAX_NAME = 40;

/** Collapse whitespace, strip control characters, trim. */
export function clean(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateSubmission(body: unknown):
  | { ok: true; message: string; name: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;
  // Honeypot: real people never fill the hidden "website" field.
  if (typeof b.website === "string" && b.website.length > 0) return { ok: false, error: "Invalid request." };
  if (typeof b.message === "string" && b.message.trim().length > MAX_MESSAGE)
    return { ok: false, error: `Please keep your wish under ${MAX_MESSAGE} characters.` };
  const message = clean(b.message, MAX_MESSAGE);
  if (message.length < 2) return { ok: false, error: "Please write your Christmas wish." };
  const name = clean(b.name, MAX_NAME);
  return { ok: true, message, name: name || null };
}
