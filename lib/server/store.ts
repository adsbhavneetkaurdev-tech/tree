import "server-only";
import type { PublicWish, TreeState, Wish, WishCounts, WishStatus } from "@/lib/types";

export interface WishStore {
  readonly kind: "supabase" | "local";
  listApproved(): Promise<PublicWish[]>;
  listAll(status?: WishStatus | "all"): Promise<Wish[]>;
  counts(): Promise<WishCounts>;
  create(message: string, name: string | null): Promise<Wish>;
  setStatus(id: string, status: WishStatus): Promise<Wish | null>;
  remove(id: string): Promise<boolean>;
  /** Archive every approved wish so the tree starts empty again. Returns the number archived. */
  resetDisplay(): Promise<number>;
  getState(): Promise<TreeState>;
  setAutoApprove(value: boolean): Promise<TreeState>;
}

/** Accepts the project URL with or without a trailing "/rest/v1/" copied from the dashboard. */
export function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getStore(): Promise<WishStore> {
  if (isSupabaseConfigured()) {
    const { getSupabaseStore } = await import("./store-supabase");
    return getSupabaseStore();
  }
  const { getLocalStore } = await import("./store-local");
  return getLocalStore();
}

export const PUBLIC_FIELDS = ["id", "message", "name", "seed", "approved_at"] as const;

export function toPublic(w: Wish): PublicWish {
  return { id: w.id, message: w.message, name: w.name, seed: w.seed, approved_at: w.approved_at };
}

export const VALID_STATUSES: WishStatus[] = ["pending", "approved", "rejected", "archived"];
