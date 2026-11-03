"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  /** Text shown instead of the image if the file is missing or fails to load. */
  fallback: string;
  className?: string;
  fallbackClassName?: string;
}

/**
 * A logo <img> that degrades to plain text when the file is missing.
 * Also catches images that failed before React hydrated (when onError
 * would never fire).
 */
export default function BrandLogo({ src, alt, fallback, className, fallbackClassName }: Props) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <span className={fallbackClassName}>{fallback}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} className={className} decoding="async" onError={() => setFailed(true)} />;
}
