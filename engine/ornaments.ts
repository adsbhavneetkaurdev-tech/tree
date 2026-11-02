import { ctx2d, makeCanvas, mulberry32 } from "./math";
import { ORNAMENT_COLORS, pickWeighted, type OrnamentColor } from "./palette";

export type OrnamentKind = "bauble" | "star" | "crystal" | "orb";
export type BaubleFinish = "gloss" | "band" | "dots" | "frosted";

/** Everything that makes a wish's ornament unique, derived from its seed. */
export interface OrnamentIdentity {
  kind: OrnamentKind;
  color: OrnamentColor;
  accent: OrnamentColor;
  finish: BaubleFinish;
  sizeMul: number;
  twinkleSpeed: number;
  twinklePhase: number;
  swayPhase: number;
  swaySpeed: number;
  glintEvery: number;
  glintOffset: number;
  points: number; // for stars
}

export function identityFor(seed: number): OrnamentIdentity {
  const r = mulberry32(seed ^ 0x5eed);
  const k = r();
  const kind: OrnamentKind = k < 0.46 ? "bauble" : k < 0.68 ? "star" : k < 0.84 ? "crystal" : "orb";
  const color = pickWeighted(ORNAMENT_COLORS, r());
  const gold = ORNAMENT_COLORS[0];
  const champagne = ORNAMENT_COLORS[1];
  const accent = color.key === "gold" ? (r() < 0.5 ? champagne : ORNAMENT_COLORS[2]) : gold;
  const f = r();
  const finish: BaubleFinish = f < 0.45 ? "gloss" : f < 0.7 ? "band" : f < 0.87 ? "dots" : "frosted";
  return {
    kind,
    color: kind === "star" && (color.key === "red" || color.key === "frost") ? gold : color,
    accent,
    finish,
    sizeMul: 0.86 + r() * 0.3,
    twinkleSpeed: 0.6 + r() * 1.4,
    twinklePhase: r() * Math.PI * 2,
    swayPhase: r() * Math.PI * 2,
    swaySpeed: 0.5 + r() * 0.6,
    glintEvery: 7 + r() * 9,
    glintOffset: r() * 16,
    points: r() < 0.75 ? 5 : r() < 0.5 ? 6 : 8,
  };
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Logical size the sprite is drawn at, for a body radius of `r`. */
  w: number;
  h: number;
  /** Logical offset from the sprite's top-left to the ornament centre. */
  ax: number;
  ay: number;
  r: number;
}

/**
 * Renders an ornament body (no glow) at radius `r` logical units with `px`
 * device pixels per unit. Glow is drawn live so it can twinkle.
 */
export function renderOrnament(id: OrnamentIdentity, r: number, px: number, seed: number): Sprite {
  const pad = 4;
  const thread = id.kind === "bauble" || id.kind === "crystal" ? r * 1.1 : 0;
  const bodyH = id.kind === "crystal" ? r * 2.6 : r * 2.2;
  const w = r * 2.4 + pad * 2;
  const h = bodyH + thread + pad * 2 + r * 0.4;
  const canvas = makeCanvas(w * px, h * px);
  const ctx = ctx2d(canvas);
  ctx.scale(px, px);
  const cx = w / 2;
  const cy = pad + thread + r * 1.2;
  const c = id.color;

  if (thread) {
    ctx.strokeStyle = "rgba(240, 214, 160, 0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(cx, cy - r);
    ctx.stroke();
  }

  if (id.kind === "bauble") drawBauble(ctx, cx, cy, r, id, seed);
  else if (id.kind === "star") drawStar(ctx, cx, cy, r * 1.15, id.points, c);
  else if (id.kind === "crystal") drawCrystal(ctx, cx, cy, r, c);
  else drawOrb(ctx, cx, cy, r, c);

  return { canvas, w, h, ax: cx, ay: cy, r };
}

function drawBauble(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, id: OrnamentIdentity, seed: number) {
  const c = id.color;
  // Cap
  const capW = r * 0.5, capH = r * 0.32;
  const cg = ctx.createLinearGradient(cx - capW / 2, 0, cx + capW / 2, 0);
  cg.addColorStop(0, "#6e4a16");
  cg.addColorStop(0.45, "#f6dc9c");
  cg.addColorStop(1, "#7a5418");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.roundRect(cx - capW / 2, cy - r - capH * 0.7, capW, capH, capH * 0.25);
  ctx.fill();

  // Sphere
  const g = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.05, cx, cy, r * 1.05);
  g.addColorStop(0, c.light);
  g.addColorStop(0.28, c.base);
  g.addColorStop(0.82, c.dark);
  g.addColorStop(1, "#050302");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  if (id.finish === "band") {
    const a = id.accent;
    ctx.strokeStyle = a.base;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.05, r * 1.02, r * 0.28, 0, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.32, r * 1.0, r * 0.26, 0, 0, Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (id.finish === "dots") {
    const rr = mulberry32(seed);
    ctx.fillStyle = id.accent.light;
    for (let i = 0; i < 14; i++) {
      const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * r * 0.85;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const edge = 1 - d / r;
      ctx.globalAlpha = 0.35 + edge * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, r * 0.07 * (0.5 + edge)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (id.finish === "frosted") {
    const rr = mulberry32(seed + 1);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(cx + (rr() * 2 - 1) * r, cy + (rr() * 2 - 1) * r, 0.7, 0.7);
    }
  }

  // Reflection of the warm room light along the bottom rim
  const rim = ctx.createRadialGradient(cx + r * 0.2, cy + r * 0.9, 0, cx + r * 0.2, cy + r * 0.9, r * 0.8);
  rim.addColorStop(0, "rgba(255, 200, 120, 0.35)");
  rim.addColorStop(1, "rgba(255, 200, 120, 0)");
  ctx.fillStyle = rim;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  // Specular highlight
  const s = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, 0, cx - r * 0.36, cy - r * 0.42, r * 0.42);
  s.addColorStop(0, "rgba(255,255,255,0.95)");
  s.addColorStop(0.35, "rgba(255,255,255,0.35)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.34, cy - r * 0.4, r * 0.34, r * 0.24, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, points: number, c: OrnamentColor) {
  const inner = r * (points === 8 ? 0.48 : 0.44);
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? r : inner;
    verts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  }
  // Faceted: each half-point is a triangle shaded as if lit from the top-left.
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    const light = (-mx * 0.6 - my * 0.8) / (Math.hypot(mx, my) || 1);
    ctx.fillStyle = light > 0.25 ? c.light : light > -0.3 ? c.base : c.dark;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255, 244, 214, 0.5)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  verts.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
  ctx.closePath();
  ctx.stroke();
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, inner);
  core.addColorStop(0, "rgba(255,255,255,0.9)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
}

function drawCrystal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: OrnamentColor) {
  // Elongated teardrop prism with facets.
  const top = cy - r * 1.0, bottom = cy + r * 1.55, wide = r * 0.72, mid = cy - r * 0.05;
  const xs = [-1, -0.35, 0.35, 1].map((k) => cx + k * wide);
  for (let i = 0; i < 3; i++) {
    const shade = i === 0 ? c.dark : i === 1 ? c.light : c.base;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(xs[i], mid);
    ctx.lineTo(xs[i + 1], mid);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = i === 1 ? c.base : i === 0 ? c.base : c.dark;
    ctx.beginPath();
    ctx.moveTo(xs[i], mid);
    ctx.lineTo(xs[i + 1], mid);
    ctx.lineTo(cx, bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(xs[0], mid);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(xs[3], mid);
  ctx.closePath();
  ctx.moveTo(xs[0], mid);
  ctx.lineTo(xs[3], mid);
  ctx.stroke();
  const s = ctx.createRadialGradient(cx - wide * 0.3, mid - r * 0.3, 0, cx - wide * 0.3, mid - r * 0.3, r * 0.5);
  s.addColorStop(0, "rgba(255,255,255,0.9)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s;
  ctx.fillRect(cx - wide, top, wide * 2, bottom - top);
}

function drawOrb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: OrnamentColor) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.75);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, c.light);
  g.addColorStop(0.75, c.base);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
}

/** Soft radial glow sprite, tinted. Drawn with additive blending. */
export function glowSprite(rgb: [number, number, number], size = 64): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  g.addColorStop(0.18, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
  g.addColorStop(0.45, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.14)`);
  g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
