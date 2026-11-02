import { getStore, VALID_STATUSES } from "@/lib/server/store";
import { json, requireAdmin, serverError } from "@/lib/server/http";
import type { WishStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const param = new URL(req.url).searchParams.get("status") ?? "all";
  const status = (VALID_STATUSES as string[]).includes(param) ? (param as WishStatus) : "all";
  try {
    const store = await getStore();
    const [wishes, counts, state] = await Promise.all([store.listAll(status), store.counts(), store.getState()]);
    return json({ wishes, counts, state, storage: store.kind });
  } catch (err) {
    return serverError(err);
  }
}
