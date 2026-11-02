import type { Metadata } from "next";
import { adminConfigured, isAdmin } from "@/lib/server/auth";
import { realtimeConfig } from "@/lib/server/realtime-config";
import { guestUrl } from "@/lib/guest-url";
import AdminLogin from "./AdminLogin";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · The Christmas Wish Tree", robots: { index: false } };

export default async function AdminPage() {
  if (!(await isAdmin())) return <AdminLogin configured={adminConfigured()} />;
  return <AdminDashboard realtime={realtimeConfig()} guestUrl={await guestUrl()} />;
}
