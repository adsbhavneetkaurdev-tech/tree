"use client";

import { useEffect } from "react";
import MorusCredit from "@/components/MorusCredit";
import styles from "./status-page.module.css";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[wish-tree]", error);
  }, [error]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>The Christmas Wish Tree</p>
        <h1 className={styles.title}>A little Christmas hiccup</h1>
        <p className={styles.text}>Something went wrong loading this page. Please try again.</p>
        <button className={styles.button} onClick={reset}>Try again</button>
      </div>
      <MorusCredit />
    </main>
  );
}
