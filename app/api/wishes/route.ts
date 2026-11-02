import { getStore } from "@/lib/server/store";
import { json, serverError } from "@/lib/server/http";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";
import { validateSubmission } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Public: approved wishes for the display. */
export async function GET() {
  try {
    const store = await getStore();
    const [wishes, state] = await Promise.all([store.listApproved(), store.getState()]);
    return json({ wishes, version: state.version });
  } catch (err) {
    return serverError(err);
  }
}

/** Public: submit a wish. No account required. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const v = validateSubmission(body);
  if (!v.ok) return json({ error: v.error }, 400);

  // Venue Wi-Fi often puts every guest behind one IP, so the per-IP limit is
  // generous and the tighter limit is per device (random id kept in localStorage).
  const ip = clientKey(req);
  const device = typeof (body as { device?: unknown }).device === "string"
    ? String((body as { device: string }).device).slice(0, 64)
    : "none";
  if (!rateLimit(`ip:${ip}`, 120, 60_000) || !rateLimit(`dev:${ip}:${device}`, 4, 60_000)) {
    return json({ error: "So many wishes! Please wait a moment before sending another." }, 429);
  }

  try {
    const store = await getStore();
    const wish = await store.create(v.message, v.name);
    return json({ ok: true, id: wish.id, status: wish.status, seed: wish.seed }, 201);
  } catch (err) {
    return serverError(err);
  }
}
