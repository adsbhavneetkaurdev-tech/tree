import { ADMIN_COOKIE, adminConfigured, checkPassword, createSessionToken } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { clientKey, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: "ADMIN_PASSWORD is not configured on the server." }, 500);
  if (!rateLimit(`login:${clientKey(req)}`, 10, 5 * 60_000)) {
    return json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof body.password !== "string" || !checkPassword(body.password)) {
    return json({ error: "Incorrect password." }, 401);
  }
  const { token, maxAge } = createSessionToken();
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}

export async function DELETE() {
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
