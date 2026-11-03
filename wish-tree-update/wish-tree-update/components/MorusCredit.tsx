import BrandLogo from "./BrandLogo";
import styles from "./branding.module.css";

export const MORUS_URL = "https://morusai.com";
export const MORUS_LOGO = "/morus-ai-logo.png";

/**
 * "Created by Morus AI" credit, used on every page.
 *  - footer:  centred page footer (guest, admin, QR, error pages)
 *  - display: small, semi-transparent corner badge for the projector
 */
export default function MorusCredit({ variant = "footer" }: { variant?: "footer" | "display" }) {
  const link = (
    <a
      href={MORUS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.credit} ${variant === "display" ? styles.creditDisplay : ""}`}
      aria-label="Created by Morus AI (opens morusai.com in a new tab)"
    >
      <span className={styles.creditText}>Created by</span>
      <span className={styles.chip}>
        <BrandLogo src={MORUS_LOGO} alt="Morus AI logo" fallback="Morus AI" className={styles.morusLogo} fallbackClassName={styles.morusFallback} />
      </span>
    </a>
  );
  if (variant === "display") return link;
  return <footer className={styles.footer}>{link}</footer>;
}
