"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { WishTreeEngine, cornerPinMatrix, rectCorners, DEFAULT_TREE, type Corners, type TreeGeometry } from "@/engine";
import { subscribeToChanges, type ConnectionState } from "@/lib/realtime-client";
import type { PublicWish, RealtimeConfig } from "@/lib/types";
import MorusCredit from "@/components/MorusCredit";
import styles from "./display.module.css";

interface Props {
  realtime: RealtimeConfig;
  guestUrl: string;
  fonts: { serif: string; sans: string };
}

const PIN_KEY = "wt_cornerpin_v1";

type Fit = { w: number; h: number; x: number; y: number; vw: number; vh: number };

function fit16x9(vw: number, vh: number): Fit {
  const w = Math.min(vw, (vh * 16) / 9);
  const h = (w * 9) / 16;
  return { w, h, x: (vw - w) / 2, y: (vh - h) / 2, vw, vh };
}

function parseGeometry(v: string | null): Partial<TreeGeometry> | undefined {
  if (!v) return undefined;
  const [cx, top, base, halfWidth] = v.split(",").map(Number);
  if ([cx, top, base, halfWidth].some((n) => !Number.isFinite(n))) return undefined;
  return { cx, top, base, halfWidth };
}

function loadPin(): Corners | null {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Corners;
    return Array.isArray(c) && c.length === 4 ? c : null;
  } catch {
    return null;
  }
}

export default function DisplayClient({ realtime, guestUrl, fonts }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WishTreeEngine | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [pin, setPin] = useState<Corners | null>(null); // normalised 0..1 of viewport
  const [calibrating, setCalibrating] = useState(false);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [idle, setIdle] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(true);
  const qrImage = useRef<HTMLCanvasElement | null>(null);

  // ── Engine lifecycle ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    const quality = (params.get("quality") as "high" | "medium" | "low") || "high";
    const qrOn = params.get("qr") !== "0";
    setShowQr(qrOn);
    const engine = new WishTreeEngine(canvas, {
      fonts,
      geometry: parseGeometry(params.get("tree")) ?? DEFAULT_TREE,
      background: params.get("bg") === "black" ? "black" : "scene",
      showUi: params.get("ui") !== "0",
      showCards: params.get("cards") !== "0",
      quality,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    engineRef.current = engine;

    const f = fit16x9(window.innerWidth, window.innerHeight);
    engine.resize(f.w, f.h);
    setFit(f);
    setPin(loadPin());
    engine.start();

    // Make sure the web fonts are actually loaded before text is cached on canvas.
    // Load only the primary family: next/font's metric fallback faces use local()
    // sources that may not exist on the projector machine.
    const primary = (f: string) => f.split(",")[0].trim();
    Promise.all([
      document.fonts.load(`italic 400 28px ${primary(fonts.serif)}`),
      document.fonts.load(`400 48px ${primary(fonts.serif)}`),
      document.fonts.load(`500 14px ${primary(fonts.sans)}`),
    ]).catch(() => {}).finally(() => engine.refreshFonts());

    if (qrOn) {
      const c = document.createElement("canvas");
      QRCode.toCanvas(c, guestUrl, {
        margin: 0,
        width: 600,
        errorCorrectionLevel: "M",
        color: { dark: "#06140fff", light: "#f4e4bcff" },
      }).then(() => {
        qrImage.current = c;
        engine.setOptions({ qr: { image: c, label: ["Scan to add", "your Christmas wish"] } });
      }).catch(() => {});
    }

    return () => engine.destroy();
  }, [fonts, guestUrl]);

  // ── Resize ──
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const f = fit16x9(window.innerWidth, window.innerHeight);
        setFit(f);
        engineRef.current?.resize(f.w, f.h);
      }, 120);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Data + realtime ──
  const inflight = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      const res = await fetch("/api/wishes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { wishes: PublicWish[] };
      engineRef.current?.setWishes(data.wishes);
      setCount(data.wishes.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "offline");
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; void refresh(); }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToChanges(realtime, () => void refresh(), setConn);
  }, [realtime, refresh]);

  // ── Keep the projector awake ──
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try { lock = await navigator.wakeLock?.request("screen"); } catch {}
    };
    void req();
    const onVis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); void lock?.release().catch(() => {}); };
  }, []);

  // ── Idle cursor / controls ──
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => { clearTimeout(t); window.removeEventListener("mousemove", wake); window.removeEventListener("keydown", wake); };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const toggleQr = useCallback(() => {
    setShowQr((s) => {
      const next = !s;
      engineRef.current?.setOptions({ qr: next && qrImage.current ? { image: qrImage.current, label: ["Scan to add", "your Christmas wish"] } : null });
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") toggleFullscreen();
      else if (k === "c") setCalibrating((c) => !c);
      else if (k === "q") toggleQr();
      else if (k === "escape") setCalibrating(false);
      else if (k === "r" && calibrating) {
        setPin(null);
        try { localStorage.removeItem(PIN_KEY); } catch {}
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calibrating, toggleFullscreen, toggleQr]);

  // ── Corner pin ──
  const cornersPx: Corners | null = fit
    ? pin
      ? (pin.map((p) => ({ x: p.x * fit.vw, y: p.y * fit.vh })) as Corners)
      : calibrating
        ? rectCorners(fit.x, fit.y, fit.w, fit.h)
        : null
    : null;

  let transform = fit ? `translate(${fit.x}px, ${fit.y}px)` : undefined;
  if (fit && cornersPx) {
    try { transform = cornerPinMatrix(fit.w, fit.h, cornersPx); } catch {}
  }

  const drag = useRef<number | null>(null);
  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = i;
    if (!pin && fit) setPin(rectCorners(fit.x, fit.y, fit.w, fit.h).map((p) => ({ x: p.x / fit.vw, y: p.y / fit.vh })) as Corners);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (drag.current === null || !fit) return;
    const i = drag.current;
    setPin((prev) => {
      const base = prev ?? (rectCorners(fit.x, fit.y, fit.w, fit.h).map((p) => ({ x: p.x / fit.vw, y: p.y / fit.vh })) as Corners);
      const next = [...base] as Corners;
      next[i] = { x: e.clientX / fit.vw, y: e.clientY / fit.vh };
      return next;
    });
  };
  const onHandleUp = () => {
    drag.current = null;
    setPin((p) => {
      try { if (p) localStorage.setItem(PIN_KEY, JSON.stringify(p)); } catch {}
      return p;
    });
  };

  return (
    <div className={`${styles.stage} ${idle && !calibrating ? styles.idle : ""}`} onDoubleClick={toggleFullscreen}>
      <div
        className={styles.frame}
        style={{ width: fit?.w, height: fit?.h, transform, ["--s" as string]: fit ? fit.w / 1920 : 1 }}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-label={`Christmas tree with ${count} wishes`} />
        <div className={styles.credit} onDoubleClick={(e) => e.stopPropagation()}>
          <MorusCredit variant="display" />
        </div>
      </div>

      {calibrating && cornersPx && (
        <div className={styles.calibrate} onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
          <svg className={styles.outline} width="100%" height="100%">
            <polygon points={cornersPx.map((p) => `${p.x},${p.y}`).join(" ")} />
          </svg>
          {cornersPx.map((p, i) => (
            <div key={i} className={styles.handle} style={{ left: p.x, top: p.y }} onPointerDown={onHandleDown(i)} />
          ))}
          <div className={styles.calibrateHelp}>
            <strong>Projection calibration</strong>
            Drag the four corners onto your projection surface. Saved automatically on this device.
            <span>R reset · C or Esc done</span>
          </div>
        </div>
      )}

      <div className={styles.hud}>
        <span className={`${styles.dot} ${styles[conn]}`} />
        {error ? `Reconnecting… (${error})` : conn === "live" ? "Live" : conn === "polling" ? "Reconnecting" : "Connecting"}
        <span className={styles.sep}>·</span>
        {count} approved
        <span className={styles.sep}>·</span>
        <kbd>F</kbd> fullscreen <kbd>C</kbd> calibrate <kbd>Q</kbd> {showQr ? "hide" : "show"} QR
      </div>
    </div>
  );
}
