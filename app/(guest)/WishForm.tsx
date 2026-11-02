"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE, MAX_NAME } from "@/lib/validation";
import styles from "./guest.module.css";

type Phase = "idle" | "sending" | "sent";

function deviceId(): string {
  try {
    let id = localStorage.getItem("wt_device");
    if (!id) {
      id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
      localStorage.setItem("wt_device", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export default function WishForm() {
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [message]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "sending") return;
    const trimmed = message.trim();
    if (trimmed.length < 2) {
      setError("Please write your Christmas wish.");
      textRef.current?.focus();
      return;
    }
    setError(null);
    setPhase("sending");
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, name: name.trim(), device: deviceId(), website: honeypot.current?.value ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Your wish couldn't be sent. Please try again.");
      setApproved(data.status === "approved");
      setPhase("sent");
      navigator.vibrate?.([18, 40, 18]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your wish couldn't be sent. Please try again.");
      setPhase("idle");
    }
  }

  function again() {
    setMessage("");
    setPhase("idle");
    setTimeout(() => textRef.current?.focus(), 50);
  }

  if (phase === "sent") {
    return (
      <section className={styles.confirm} role="status" aria-live="polite">
        <div className={styles.launch} aria-hidden>
          <span className={styles.orb} />
          <span className={styles.trail} />
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className={styles.burst} style={{ ["--a" as string]: `${(i / 14) * 360}deg`, ["--d" as string]: `${i % 2 ? 64 : 92}px` }} />
          ))}
        </div>
        <h2 className={styles.confirmTitle}>Your wish is on its way</h2>
        <p className={styles.confirmText}>
          {approved
            ? "Look up at the tree — your wish is about to take its place among the lights."
            : "It has been received and will join the tree in a moment, once our elves have given it a final polish."}
        </p>
        <blockquote className={styles.echo}>“{message.trim()}”</blockquote>
        <button type="button" className={styles.secondary} onClick={again}>
          Make another wish
        </button>
      </section>
    );
  }

  const remaining = MAX_MESSAGE - message.length;

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label className={styles.label} htmlFor="wish">What is your Christmas wish?</label>
      <div className={styles.field}>
        <textarea
          id="wish"
          ref={textRef}
          className={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
          placeholder="I wish for…"
          rows={3}
          maxLength={MAX_MESSAGE}
          required
          enterKeyHint="done"
          aria-describedby="wish-count"
        />
        <span id="wish-count" className={`${styles.count} ${remaining < 20 ? styles.countLow : ""}`}>
          {remaining}
        </span>
      </div>

      <label className={styles.label} htmlFor="name">
        Your name <span className={styles.optional}>(optional)</span>
      </label>
      <div className={styles.field}>
        <input
          id="name"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
          placeholder="Leave blank to wish anonymously"
          maxLength={MAX_NAME}
          autoComplete="given-name"
          enterKeyHint="send"
        />
      </div>

      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" className={styles.hp} aria-hidden />

      {error && <p className={styles.error} role="alert">{error}</p>}

      <button type="submit" className={styles.primary} disabled={phase === "sending"}>
        {phase === "sending" ? <span className={styles.spinner} aria-label="Sending" /> : "Add My Wish"}
      </button>
    </form>
  );
}
