import { NextResponse, type NextRequest } from "next/server";

/**
 * Deployment-role gate. The same codebase can be deployed twice so the guest
 * submission site and the display/admin site are fully separate:
 *
 *   APP_ROLE=guest    → only "/" and POST /api/wishes
 *   APP_ROLE=display  → only /display, /admin, /qr and their APIs
 *   APP_ROLE=all      → everything (default; handy for local development)
 */
const GUEST_PATHS = [/^\/$/, /^\/api\/wishes$/];
const DISPLAY_PATHS = [/^\/display/, /^\/admin/, /^\/qr/, /^\/api\/(admin|stream)/, /^\/api\/wishes$/];

export function proxy(req: NextRequest) {
  const role = (process.env.APP_ROLE || "all").toLowerCase();
  if (role === "all") return NextResponse.next();
  const { pathname } = req.nextUrl;

  if (role === "guest") {
    if (pathname === "/api/wishes" && req.method !== "POST") return new NextResponse(null, { status: 405 });
    if (GUEST_PATHS.some((r) => r.test(pathname))) return NextResponse.next();
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (role === "display") {
    if (pathname === "/api/wishes" && req.method === "POST") return new NextResponse(null, { status: 405 });
    if (DISPLAY_PATHS.some((r) => r.test(pathname))) return NextResponse.next();
    return NextResponse.redirect(new URL("/display", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon|icon|robots).*)"],
};
