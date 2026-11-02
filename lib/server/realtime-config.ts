import "server-only";
import type { RealtimeConfig } from "@/lib/types";
import { isSupabaseConfigured } from "./store";

export function realtimeConfig(): RealtimeConfig {
  if (isSupabaseConfigured() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      mode: "supabase",
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
  }
  return { mode: "local" };
}
