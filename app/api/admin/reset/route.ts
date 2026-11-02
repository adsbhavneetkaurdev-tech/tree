import { getStore } from "@/lib/server/store";
import { json, requireAdmin, serverError } from "@/lib/server/http";

/** Clears the tree by archiving every approved wish. Archived wishes can be restored from the dashboard. */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const archived = await (await getStore()).resetDisplay();
    return json({ ok: true, archived });
  } catch (err) {
    return serverError(err);
  }
}
