import "server-only";
import { NextResponse } from "next/server";
import { isAdmin } from "./auth";

export const noStore = { "Cache-Control": "no-store, max-age=0" };

export function json(data: unknown, init: number | ResponseInit = 200) {
  const opts = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, { ...opts, headers: { ...noStore, ...(opts.headers ?? {}) } });
}

export async function requireAdmin(): Promise<NextResponse | null> {
  return (await isAdmin()) ? null : json({ error: "Unauthorized" }, 401);
}

export function serverError(err: unknown) {
  console.error("[wish-tree]", err);
  return json({ error: "Something went wrong. Please try again." }, 500);
}
