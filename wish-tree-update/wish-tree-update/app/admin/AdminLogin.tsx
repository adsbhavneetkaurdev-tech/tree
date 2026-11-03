"use client";

import { useState } from "react";
import MorusCredit from "@/components/MorusCredit";
import styles from "./admin.module.css";

export default function AdminLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.reload();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error || "Sign-in failed.");
    setBusy(false);
  }

  return (
    <main className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={submit}>
        <p className={styles.eyebrow}>The Christmas Wish Tree</p>
        <h1 className={styles.loginTitle}>Moderator sign-in</h1>
        {!configured && (
          <p className={styles.warn}>Set <code>ADMIN_PASSWORD</code> in your environment to enable the dashboard.</p>
        )}
        <label className={styles.fieldLabel} htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          className={styles.textInput}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          required
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.btnGold} disabled={busy || !configured}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <MorusCredit />
    </main>
  );
}
