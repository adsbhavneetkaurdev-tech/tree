export type WishStatus = "pending" | "approved" | "rejected" | "archived";

export interface Wish {
  id: string;
  message: string;
  name: string | null;
  status: WishStatus;
  seed: number;
  created_at: string;
  approved_at: string | null;
}

/** The subset of a wish that is safe to show publicly on the display. */
export type PublicWish = Pick<Wish, "id" | "message" | "name" | "seed" | "approved_at">;

export interface TreeState {
  version: number;
  auto_approve: boolean;
  reset_at: string | null;
}

export interface WishCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}

export type RealtimeConfig =
  | { mode: "supabase"; url: string; anonKey: string }
  | { mode: "local" };
