import BrandLogo from "./BrandLogo";
import styles from "./branding.module.css";

export const HOST_LOGO = "/brar-mortgages-logo.png";

/** Event host / sponsor block shown on the guest wish form. */
export default function HostedBy({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.hosted} ${compact ? styles.hostedCompact : ""}`}>
      <span className={styles.hostedLabel}>Hosted by</span>
      <span className={styles.hostChip}>
        <BrandLogo src={HOST_LOGO} alt="Brar Mortgages logo" fallback="Brar Mortgages" className={styles.hostLogo} fallbackClassName={styles.hostFallback} />
      </span>
    </div>
  );
}
