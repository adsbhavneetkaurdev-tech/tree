import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events change feed for LOCAL mode only. In Supabase mode the
 * browser subscribes to Supabase Realtime directly, so this returns 204.
 */
export async function GET(req: Request) {
  const store = await getStore();
  if (store.kind !== "local") return new Response(null, { status: 204 });
  const { getLocalStore } = await import("@/lib/server/store-local");
  const local = getLocalStore();
  const initial = (await local.getState()).version;

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (v: number) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ version: v })}\n\n`));
        } catch {
          cleanup();
        }
      };
      send(initial);
      const onChange = (v: number) => send(v);
      local.events.on("change", onChange);
      const ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { cleanup(); }
      }, 20_000);
      cleanup = () => {
        clearInterval(ping);
        local.events.off("change", onChange);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
