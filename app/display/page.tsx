import type { Metadata } from "next";
import { realtimeConfig } from "@/lib/server/realtime-config";
import { guestUrl } from "@/lib/guest-url";
import { serif, sans } from "../fonts";
import DisplayClient from "./DisplayClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Display · The Christmas Wish Tree" };

export default async function DisplayPage() {
  return (
    <DisplayClient
      realtime={realtimeConfig()}
      guestUrl={await guestUrl()}
      fonts={{ serif: serif.style.fontFamily, sans: sans.style.fontFamily }}
    />
  );
}
