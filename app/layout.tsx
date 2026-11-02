import type { Metadata, Viewport } from "next";
import { serif, sans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Christmas Wish Tree",
  description: "Every wish makes the tree shine brighter.",
};

export const viewport: Viewport = {
  themeColor: "#06140f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
