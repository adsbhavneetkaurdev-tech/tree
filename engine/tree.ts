import { clamp, ctx2d, makeCanvas, mulberry32 } from "./math";

/**
 * Tree geometry in logical (1920×1080) coordinates. Exposed so the tree can be
 * lined up with a physical surface when projection mapping.
 */
export interface TreeGeometry {
  cx: number;
  top: number;
  base: number;
  halfWidth: number;
}

export const DEFAULT_TREE: TreeGeometry = { cx: 960, top: 142, base: 880, halfWidth: 368 };

/** Envelope of the silhouette (no tier modulation) — used for layout and lights. */
export function halfWidthAt(g: TreeGeometry, y: number): number {
  const t = (y - g.top) / (g.base - g.top);
  if (t <= 0) return 0;
  return g.halfWidth * Math.pow(Math.min(t, 1), 0.9);
}

export interface LightPoint {
  x: number;
  y: number;
  depth: number; // 0 = side, 1 = facing viewer
}

export interface TreeBuild {
  canvas: HTMLCanvasElement;
  lights: LightPoint[];
}

const TIERS = 7;
const MAX_L = 30;

interface Branch {
  y: number;
  theta: number;
  len: number;
  hue: number;
  sat: number;
  depth: number; // sin(theta): -1 back … +1 front
  seed: number;
}

/**
 * Paints a realistic evergreen into an offscreen canvas at `scale` pixels per
 * logical unit. Thousands of individually shaded needles are batched into a
 * handful of strokes per branch so this stays fast.
 */
export function renderTree(g: TreeGeometry, scale: number, W = 1920, H = 1080, seed = 2026): TreeBuild {
  const canvas = makeCanvas(W * scale, H * scale);
  const ctx = ctx2d(canvas);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const rnd = mulberry32(seed);
  const height = g.base - g.top;
  const lights: LightPoint[] = [];

  // ── Trunk ──
  const trunkW = g.halfWidth * 0.075;
  const tg = ctx.createLinearGradient(g.cx - trunkW, 0, g.cx + trunkW, 0);
  tg.addColorStop(0, "#120a05");
  tg.addColorStop(0.45, "#3a2414");
  tg.addColorStop(1, "#0d0703");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(g.cx - trunkW * 0.5, g.top + height * 0.78);
  ctx.lineTo(g.cx + trunkW * 0.5, g.top + height * 0.78);
  ctx.lineTo(g.cx + trunkW, g.base + 46);
  ctx.quadraticCurveTo(g.cx, g.base + 54, g.cx - trunkW, g.base + 46);
  ctx.closePath();
  ctx.fill();

  // ── Generate branches ──
  const branches: Branch[] = [];
  const rowStep = 4.6;
  for (let y = g.top + 6; y < g.base - 6; y += rowStep) {
    const t = (y - g.top) / height;
    const env = halfWidthAt(g, y);
    const tierPhase = (t * TIERS + 0.35) % 1;
    const mod = 0.8 + 0.2 * Math.pow(tierPhase, 0.65);
    const count = Math.round(2 + t * 4.5 + (t > 0.8 ? 2 : 0) + rnd() * 1.5);
    for (let i = 0; i < count; i++) {
      const theta = rnd() * Math.PI * 2;
      branches.push({
        y: y + (rnd() - 0.5) * rowStep,
        theta,
        len: Math.max(8, env * mod * (0.78 + rnd() * 0.28)),
        hue: 144 + rnd() * 14,
        sat: 34 + rnd() * 24,
        depth: Math.sin(theta),
        seed: (rnd() * 1e9) | 0,
      });
    }
  }
  branches.sort((a, b) => a.depth - b.depth);

  // ── Draw branches back-to-front with batched needle strokes ──
  const BUCKETS = 12;
  const paths: Path2D[] = new Array(BUCKETS);
  ctx.lineCap = "round";

  for (const br of branches) {
    const r = mulberry32(br.seed);
    for (let i = 0; i < BUCKETS; i++) paths[i] = new Path2D();
    const front = (br.depth + 1) / 2; // 0 back, 1 front
    const tierT = (br.y - g.top) / height;
    const tierLift = Math.pow((tierT * TIERS + 0.35) % 1, 1.5) * 4; // tier edges catch light
    const droop = br.len * (0.22 + r() * 0.12);
    const cos = Math.cos(br.theta), sin = Math.sin(br.theta);
    const steps = Math.max(3, Math.floor(br.len / 3.4));

    const pt = (s: number) => {
      const x = g.cx + cos * br.len * s;
      const z = sin * br.len * s;
      const y = br.y + droop * Math.pow(s, 1.55) - br.len * 0.05 * Math.pow(s, 5) + z * 0.1;
      return { x, y };
    };

    const needle = (x: number, y: number, dx: number, dy: number, s: number, lenMul: number) => {
      // Two needles fanning off each side of the stem.
      for (const side of [-1, 1]) {
        const ang = side * (0.85 + r() * 0.45);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = dx * ca - dy * sa, ny = dx * sa + dy * ca;
        const len = (5.5 + r() * 6.5) * lenMul * (1 - s * 0.35);
        let l = 3 + front * 13 + s * 6 + tierLift + (r() - 0.3) * 6;
        if (side < 0 && ny < 0) l += 2.5; // upper needles catch more light
        const bucket = clamp(Math.floor((l / MAX_L) * BUCKETS), 0, BUCKETS - 1);
        const p = paths[bucket];
        p.moveTo(x, y);
        p.lineTo(x + nx * len, y + ny * len + 1.2);
      }
    };

    let prev = pt(0);
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      const cur = pt(s);
      let dx = cur.x - prev.x, dy = cur.y - prev.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      if (s > 0.12) needle(cur.x, cur.y, dx, dy, s, 1);

      // Side branchlets give the dense, layered fir look.
      if (i % 4 === 0 && s > 0.2 && s < 0.95) {
        for (const side of [-1, 1]) {
          const ang = side * (0.55 + r() * 0.35);
          const bx = dx * Math.cos(ang) - dy * Math.sin(ang);
          const by = dx * Math.sin(ang) + dy * Math.cos(ang);
          const blen = br.len * (0.14 + r() * 0.1) * (1 - s * 0.4);
          const bsteps = Math.max(2, Math.floor(blen / 3.6));
          for (let j = 1; j <= bsteps; j++) {
            const bs = j / bsteps;
            needle(cur.x + bx * blen * bs, cur.y + by * blen * bs + bs * bs * 3, bx, by, Math.min(1, s + bs * 0.3), 0.8);
          }
        }
      }

      if (br.depth > 0.05 && s > 0.35 && r() < 0.035) {
        lights.push({ x: cur.x, y: cur.y, depth: br.depth });
      }
      prev = cur;
    }

    // Stem (subtle) — skipped for branches pointing at/away from the viewer,
    // which would otherwise stack into a dark line down the middle.
    if (Math.abs(cos) > 0.45) {
    ctx.strokeStyle = `hsla(30, 25%, ${6 + front * 6}%, 0.45)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const p0 = pt(0);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i <= steps; i += 2) {
      const p = pt(i / steps);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    }

    ctx.lineWidth = 1.25;
    for (let b = 0; b < BUCKETS; b++) {
      const l = ((b + 0.5) / BUCKETS) * MAX_L;
      ctx.strokeStyle = `hsl(${br.hue - l * 0.2}, ${br.sat + l * 0.4}%, ${l}%)`;
      ctx.stroke(paths[b]);
    }
  }

  // ── Frost: a faint dusting on upper, front-facing needles ──
  const frost = mulberry32(seed + 7);
  ctx.strokeStyle = "rgba(225, 240, 232, 0.12)";
  ctx.lineWidth = 1.1;
  const fp = new Path2D();
  for (let i = 0; i < 2600; i++) {
    const y = g.top + 30 + frost() * (height - 40);
    const w = halfWidthAt(g, y) * 0.95;
    const x = g.cx + (frost() * 2 - 1) * w;
    const len = 3 + frost() * 6;
    fp.moveTo(x, y);
    fp.lineTo(x + (frost() - 0.5) * len * 2, y - frost() * 1.2);
  }
  ctx.stroke(fp);

  // ── Volume shading (only where needles exist) ──
  ctx.globalCompositeOperation = "source-atop";
  const side = ctx.createLinearGradient(g.cx - g.halfWidth * 1.1, 0, g.cx + g.halfWidth * 1.1, 0);
  side.addColorStop(0, "rgba(0,0,0,0.6)");
  side.addColorStop(0.3, "rgba(0,0,0,0.12)");
  side.addColorStop(0.5, "rgba(0,0,0,0)");
  side.addColorStop(0.7, "rgba(0,0,0,0.12)");
  side.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, W, H);

  const warm = ctx.createRadialGradient(g.cx, g.top + height * 0.62, 10, g.cx, g.top + height * 0.62, height * 0.7);
  warm.addColorStop(0, "rgba(255, 190, 110, 0.16)");
  warm.addColorStop(0.6, "rgba(255, 170, 90, 0.05)");
  warm.addColorStop(1, "rgba(255, 170, 90, 0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, H);

  const bottom = ctx.createLinearGradient(0, g.top, 0, g.base + 40);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(0.75, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // Shuffle lights so that taking the first N gives an even spread.
  for (let i = lights.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [lights[i], lights[j]] = [lights[j], lights[i]];
  }
  return { canvas, lights };
}

/**
 * Candidate ornament positions, ordered by farthest-point sampling so the first
 * N slots are always evenly spread across the tree, whatever N is.
 */
export function ornamentSlots(g: TreeGeometry, count = 1200, seed = 77): { x: number; y: number }[] {
  const rnd = mulberry32(seed);
  const cands: { x: number; y: number }[] = [];
  const yMin = g.top + 70;
  const yMax = g.base - 42; // keep the lowest boughs clear for the arrival caption
  while (cands.length < count * 5) {
    const y = yMin + rnd() * (yMax - yMin);
    const w = halfWidthAt(g, y) * 0.8 - 6;
    if (w <= 4) continue;
    cands.push({ x: g.cx + (rnd() * 2 - 1) * w, y });
  }
  const out: { x: number; y: number }[] = [];
  const dist = new Float64Array(cands.length).fill(Infinity);
  // Start near the visual heart of the tree.
  let pick = 0, best = Infinity;
  const hx = g.cx, hy = g.top + (g.base - g.top) * 0.55;
  cands.forEach((c, i) => {
    const d = Math.hypot(c.x - hx, c.y - hy);
    if (d < best) { best = d; pick = i; }
  });
  for (let k = 0; k < count; k++) {
    const p = cands[pick];
    out.push(p);
    let far = -1, farI = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      // Slightly squash vertical distance so rows feel natural on a cone.
      const d = (c.x - p.x) ** 2 + ((c.y - p.y) * 1.1) ** 2;
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > far) { far = dist[i]; farI = i; }
    }
    pick = farI;
  }
  return out;
}
