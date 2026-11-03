"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { subscribeToChanges, type ConnectionState } from "@/lib/realtime-client";
import type { RealtimeConfig, TreeState, Wish, WishCounts, WishStatus } from "@/lib/types";
import MorusCredit from "@/components/MorusCredit";
import styles from "./admin.module.css";

type Filter = WishStatus | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "On the tree" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

const EMPTY_COUNTS: WishCounts = { total: 0, pending: 0, approved: 0, rejected: 0, archived: 0 };

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AdminDashboard({ realtime, guestUrl }: { realtime: RealtimeConfig; guestUrl: string }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [counts, setCounts] = useState<WishCounts>(EMPTY_COUNTS);
  const [state, setState] = useState<TreeState | null>(null);
  const [storage, setStorage] = useState<"supabase" | "local" | null>(null);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/wishes?status=${filterRef.current}`, { cache: "no-store" });
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    setWishes(data.wishes);
    setCounts(data.counts);
    setState(data.state);
    setStorage(data.storage);
  }, []);

  useEffect(() => {
    void load();
  }, [filter, load]);

  useEffect(() => subscribeToChanges(realtime, () => void load(), setConn, 8000), [realtime, load]);

  useEffect(() => {
    QRCode.toDataURL(guestUrl, { margin: 1, width: 360, color: { dark: "#06140f", light: "#f4e4bc" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [guestUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function setStatus(w: Wish, status: WishStatus) {
    mark(w.id, true);
    // Optimistic: drop it from filtered views immediately.
    if (filter !== "all" && filter !== status) setWishes((ws) => ws.filter((x) => x.id !== w.id));
    const res = await fetch(`/api/admin/wishes/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    mark(w.id, false);
    if (!res.ok) setToast("That didn't work — please try again.");
    void load();
  }

  async function remove(w: Wish) {
    if (!window.confirm(`Permanently delete this wish?\n\n“${w.message}”`)) return;
    mark(w.id, true);
    setWishes((ws) => ws.filter((x) => x.id !== w.id));
    const res = await fetch(`/api/admin/wishes/${w.id}`, { method: "DELETE" });
    mark(w.id, false);
    setToast(res.ok ? "Wish deleted." : "Delete failed.");
    void load();
  }

  async function approveAllPending() {
    const pending = filter === "pending" ? wishes : wishes.filter((w) => w.status === "pending");
    if (!pending.length) return;
    if (!window.confirm(`Approve all ${pending.length} pending wishes shown?`)) return;
    setWishes((ws) => ws.filter((w) => w.status !== "pending"));
    for (let i = 0; i < pending.length; i += 8) {
      await Promise.all(
        pending.slice(i, i + 8).map((w) =>
          fetch(`/api/admin/wishes/${w.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "approved" }),
          }),
        ),
      );
    }
    setToast(`${pending.length} wishes approved.`);
    void load();
  }

  async function toggleAuto() {
    if (!state) return;
    const next = !state.auto_approve;
    setState({ ...state, auto_approve: next });
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_approve: next }),
    });
    if (!res.ok) {
      setToast("Couldn't change the setting.");
      void load();
      return;
    }
    setToast(next ? "Auto-approve on: new wishes go straight to the tree." : "Auto-approve off: wishes wait for approval.");
    void load();
  }

  async function reset() {
    setConfirmReset(false);
    const res = await fetch("/api/admin/reset", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setToast(res.ok ? `Display reset — ${data.archived ?? 0} wishes archived.` : "Reset failed.");
    void load();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.reload();
  }

  const stats = useMemo(
    () => [
      { label: "Total submissions", value: counts.total, accent: true },
      { label: "Awaiting approval", value: counts.pending },
      { label: "On the tree", value: counts.approved },
      { label: "Rejected", value: counts.rejected },
      { label: "Archived", value: counts.archived },
    ],
    [counts],
  );

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div>
          <p className={styles.eyebrow}>The Christmas Wish Tree</p>
          <h1 className={styles.h1}>Moderation</h1>
        </div>
        <div className={styles.topActions}>
          <span className={styles.connection}>
            <span className={`${styles.dot} ${styles[conn]}`} />
            {conn === "live" ? "Live" : conn === "polling" ? "Reconnecting" : "Connecting"}
            {storage && <span className={styles.badge}>{storage === "supabase" ? "Supabase" : "Local demo store"}</span>}
          </span>
          <a className={styles.btnGhost} href="/display" target="_blank" rel="noreferrer">Open display ↗</a>
          <a className={styles.btnGhost} href="/qr" target="_blank" rel="noreferrer">Print QR ↗</a>
          <button className={styles.btnText} onClick={logout}>Sign out</button>
        </div>
      </header>

      <section className={styles.stats} aria-label="Submission totals">
        {stats.map((s) => (
          <div key={s.label} className={`${styles.stat} ${s.accent ? styles.statAccent : ""}`}>
            <span className={styles.statValue} data-testid={s.accent ? "total-count" : undefined}>{s.value}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </section>

      <div className={styles.layout}>
        <section className={styles.listPanel}>
          <div className={styles.toolbar}>
            <nav className={styles.tabs} role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`${styles.tab} ${filter === f.key ? styles.tabActive : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  {f.key !== "all" && <span className={styles.tabCount}>{counts[f.key as WishStatus]}</span>}
                </button>
              ))}
            </nav>
            {filter === "pending" && wishes.length > 1 && (
              <button className={styles.btnSmallGold} onClick={approveAllPending}>Approve all</button>
            )}
          </div>

          {wishes.length === 0 ? (
            <div className={styles.empty}>
              {filter === "pending" ? "No wishes waiting. New submissions appear here instantly." : "Nothing here yet."}
            </div>
          ) : (
            <ul className={styles.list}>
              {wishes.map((w) => (
                <li key={w.id} className={`${styles.item} ${busy.has(w.id) ? styles.itemBusy : ""}`}>
                  <div className={styles.itemBody}>
                    <p className={styles.message}>“{w.message}”</p>
                    <p className={styles.meta}>
                      {w.name ? <strong>{w.name}</strong> : <em>Anonymous</em>}
                      <span>·</span>
                      <time dateTime={w.created_at}>{timeAgo(w.created_at)}</time>
                      {filter === "all" && <span className={`${styles.status} ${styles[`s_${w.status}`]}`}>{w.status}</span>}
                    </p>
                  </div>
                  <div className={styles.itemActions}>
                    {w.status !== "approved" && (
                      <button className={styles.approve} onClick={() => setStatus(w, "approved")} disabled={busy.has(w.id)}>
                        {w.status === "archived" ? "Restore" : "Approve"}
                      </button>
                    )}
                    {w.status !== "rejected" && (
                      <button className={styles.reject} onClick={() => setStatus(w, "rejected")} disabled={busy.has(w.id)}>
                        {w.status === "approved" ? "Remove from tree" : "Reject"}
                      </button>
                    )}
                    <button className={styles.delete} onClick={() => remove(w)} disabled={busy.has(w.id)} aria-label="Delete wish">
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={styles.side}>
          <div className={styles.panel}>
            <h2 className={styles.h2}>Moderation mode</h2>
            <label className={styles.switchRow}>
              <span>
                <strong>Auto-approve</strong>
                <small>New wishes appear on the tree immediately, without review.</small>
              </span>
              <button
                role="switch"
                aria-checked={state?.auto_approve ?? false}
                className={`${styles.switch} ${state?.auto_approve ? styles.switchOn : ""}`}
                onClick={toggleAuto}
                disabled={!state}
              >
                <span />
              </button>
            </label>
          </div>

          <div className={styles.panel}>
            <h2 className={styles.h2}>Guest link</h2>
            {qr && <img className={styles.qr} src={qr} alt="QR code for the guest wish page" />}
            <code className={styles.url}>{guestUrl}</code>
            <button
              className={styles.btnSmallGhost}
              onClick={() => navigator.clipboard?.writeText(guestUrl).then(() => setToast("Link copied."))}
            >
              Copy link
            </button>
          </div>

          <div className={`${styles.panel} ${styles.danger}`}>
            <h2 className={styles.h2}>Reset display</h2>
            <p className={styles.help}>
              Clears every ornament from the tree. Wishes are archived, not deleted — you can restore them from the Archived tab.
            </p>
            {confirmReset ? (
              <div className={styles.confirmRow}>
                <button className={styles.btnDanger} onClick={reset}>Yes, clear the tree</button>
                <button className={styles.btnText} onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className={styles.btnDangerGhost} onClick={() => setConfirmReset(true)} disabled={counts.approved === 0}>
                Reset display…
              </button>
            )}
          </div>
        </aside>
      </div>

      <MorusCredit />

      {toast && <div className={styles.toast} role="status">{toast}</div>}
    </main>
  );
}
