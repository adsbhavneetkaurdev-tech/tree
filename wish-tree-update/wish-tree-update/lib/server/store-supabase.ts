import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicWish, TreeState, Wish, WishCounts, WishStatus } from "@/lib/types";
import { PUBLIC_FIELDS, supabaseUrl, type WishStore } from "./store";

class SupabaseStore implements WishStore {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async listApproved() {
    const { data, error } = await this.db
      .from("wishes")
      .select(PUBLIC_FIELDS.join(","))
      .eq("status", "approved")
      .order("approved_at", { ascending: true })
      .limit(2000);
    if (error) throw error;
    return (data ?? []) as unknown as PublicWish[];
  }

  async listAll(status: WishStatus | "all" = "all") {
    let q = this.db.from("wishes").select("*").order("created_at", { ascending: false }).limit(1000);
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Wish[];
  }

  async counts(): Promise<WishCounts> {
    const statuses: WishStatus[] = ["pending", "approved", "rejected", "archived"];
    const results = await Promise.all(
      statuses.map((s) => this.db.from("wishes").select("id", { count: "exact", head: true }).eq("status", s)),
    );
    const c: WishCounts = { total: 0, pending: 0, approved: 0, rejected: 0, archived: 0 };
    results.forEach((r, i) => {
      if (r.error) throw r.error;
      c[statuses[i]] = r.count ?? 0;
      c.total += r.count ?? 0;
    });
    return c;
  }

  async create(message: string, name: string | null) {
    const state = await this.getState();
    const { data, error } = await this.db
      .from("wishes")
      .insert({ message, name, status: state.auto_approve ? "approved" : "pending" })
      .select("*")
      .single();
    if (error) throw error;
    return data as Wish;
  }

  async setStatus(id: string, status: WishStatus) {
    const { data, error } = await this.db.from("wishes").update({ status }).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    return (data as Wish) ?? null;
  }

  async remove(id: string) {
    const { data, error } = await this.db.from("wishes").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async resetDisplay() {
    const { data, error } = await this.db
      .from("wishes")
      .update({ status: "archived" })
      .eq("status", "approved")
      .select("id");
    if (error) throw error;
    await this.db.from("tree_state").update({ reset_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", 1);
    return data?.length ?? 0;
  }

  async getState(): Promise<TreeState> {
    const { data, error } = await this.db.from("tree_state").select("version,auto_approve,reset_at").eq("id", 1).single();
    if (error) throw error;
    return data as TreeState;
  }

  async setAutoApprove(value: boolean) {
    const { data, error } = await this.db
      .from("tree_state")
      .update({ auto_approve: value, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select("version,auto_approve,reset_at")
      .single();
    if (error) throw error;
    return data as TreeState;
  }
}

const g = globalThis as unknown as { __wishTreeSupabaseStore?: SupabaseStore };
export function getSupabaseStore(): SupabaseStore {
  return (g.__wishTreeSupabaseStore ??= new SupabaseStore(
    createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  ));
}
