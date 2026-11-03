import "server-only";
import type { RealtimeConfig } from "@/lib/types";
import { isSupabaseConfigured, supabaseUrl } from "./store";

export function realtimeConfig(): RealtimeConfig {
  if (isSupabaseConfigured() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      mode: "supabase",
      url: supabaseUrl(),
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim(),
    };
  }
  return { mode: "local" };
}
