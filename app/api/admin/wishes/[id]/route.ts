import { getStore, VALID_STATUSES } from "@/lib/server/store";
import { json, requireAdmin, serverError } from "@/lib/server/http";
import type { WishStatus } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: "Invalid id." }, 400);
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !(VALID_STATUSES as string[]).includes(body.status)) {
    return json({ error: "Invalid status." }, 400);
  }
  try {
    const wish = await (await getStore()).setStatus(id, body.status as WishStatus);
    return wish ? json({ wish }) : json({ error: "Not found." }, 404);
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: "Invalid id." }, 400);
  try {
    const ok = await (await getStore()).remove(id);
    return ok ? json({ ok }) : json({ error: "Not found." }, 404);
  } catch (err) {
    return serverError(err);
  }
}
