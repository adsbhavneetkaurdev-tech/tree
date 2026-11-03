import Link from "next/link";
import MorusCredit from "@/components/MorusCredit";
import styles from "./status-page.module.css";

export const metadata = { title: "Page not found · The Christmas Wish Tree" };

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>The Christmas Wish Tree</p>
        <h1 className={styles.title}>This page has wandered off into the snow</h1>
        <p className={styles.text}>The link may be mistyped, or the page has moved.</p>
        <Link className={styles.button} href="/">Make a wish</Link>
      </div>
      <MorusCredit />
    </main>
  );
}
