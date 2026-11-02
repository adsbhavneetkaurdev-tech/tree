"use client";
import type { RealtimeConfig } from "@/lib/types";

export type ConnectionState = "connecting" | "live" | "polling";

/**
 * Calls `onChange` whenever the wish set may have changed.
 *  - Supabase mode: Realtime subscription to the singleton `tree_state` row.
 *  - Local mode:    Server-Sent Events from /api/stream.
 * A slow safety-net poll and tab-visibility refresh run in both modes, so a
 * dropped socket can never leave a projector showing stale wishes.
 */
export function subscribeToChanges(
  cfg: RealtimeConfig,
  onChange: () => void,
  onState?: (s: ConnectionState) => void,
  pollMs = 15_000,
): () => void {
  let closed = false;
  let teardown: () => void = () => {};
  onState?.("connecting");

  if (cfg.mode === "supabase") {
    void (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      if (closed) return;
      const client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } });
      const channel = client
        .channel("wish-tree-state")
        .on("postgres_changes", { event: "*", schema: "public", table: "tree_state" }, () => onChange())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            onState?.("live");
            onChange(); // catch anything missed while connecting
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            onState?.("polling");
          }
        });
      teardown = () => void client.removeChannel(channel);
    })();
  } else {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/stream");
      es.onopen = () => onState?.("live");
      es.onmessage = () => onChange();
      es.onerror = () => {
        onState?.("polling");
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    teardown = () => {
      clearTimeout(retry);
      es?.close();
    };
  }

  const poll = setInterval(onChange, pollMs);
  const onVis = () => document.visibilityState === "visible" && onChange();
  document.addEventListener("visibilitychange", onVis);

  return () => {
    closed = true;
    clearInterval(poll);
    document.removeEventListener("visibilitychange", onVis);
    teardown();
  };
}
