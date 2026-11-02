import WishForm from "./WishForm";
import styles from "./guest.module.css";

export const metadata = {
  title: "Make a Wish · The Christmas Wish Tree",
};

// Deterministic sparkle field so server and client render identically.
const SPARKS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1 + 1) % 1;
  return {
    left: `${(r(1) * 100).toFixed(2)}%`,
    top: `${(r(2) * 100).toFixed(2)}%`,
    size: 1 + r(3) * 2.4,
    delay: `${(r(4) * 6).toFixed(2)}s`,
    dur: `${(3 + r(5) * 5).toFixed(2)}s`,
  };
});

export default function GuestPage() {
  return (
    <main className={styles.page}>
      <div className={styles.sky} aria-hidden>
        {SPARKS.map((s, i) => (
          <span
            key={i}
            className={styles.spark}
            style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.dur }}
          />
        ))}
      </div>

      <div className={styles.inner}>
        <header className={styles.header}>
          <svg className={styles.star} viewBox="0 0 48 48" aria-hidden>
            <defs>
              <radialGradient id="sg" cx="50%" cy="45%" r="55%">
                <stop offset="0%" stopColor="#fff8e1" />
                <stop offset="55%" stopColor="#f3d48b" />
                <stop offset="100%" stopColor="#b8873a" />
              </radialGradient>
            </defs>
            <path d="M24 3l5.6 13.2 14.3 1.1-10.9 9.3 3.4 13.9L24 33l-12.4 7.5 3.4-13.9L4.1 17.3l14.3-1.1z" fill="url(#sg)" />
          </svg>
          <p className={styles.eyebrow}>Christmas 2026</p>
          <h1 className={styles.title}>The Christmas Wish Tree</h1>
          <p className={styles.subtitle}>Every wish makes the tree shine brighter.</p>
          <div className={styles.rule} aria-hidden><span /></div>
        </header>

        <WishForm />

        <footer className={styles.footer}>
          Your wish will appear on the tree once it has been shared with the room.
        </footer>
      </div>
    </main>
  );
}
