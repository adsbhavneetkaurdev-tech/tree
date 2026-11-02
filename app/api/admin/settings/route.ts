import { getStore } from "@/lib/server/store";
import { json, requireAdmin, serverError } from "@/lib/server/http";

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { auto_approve?: unknown };
  if (typeof body.auto_approve !== "boolean") return json({ error: "auto_approve must be boolean." }, 400);
  try {
    const state = await (await getStore()).setAutoApprove(body.auto_approve);
    return json({ state });
  } catch (err) {
    return serverError(err);
  }
}
