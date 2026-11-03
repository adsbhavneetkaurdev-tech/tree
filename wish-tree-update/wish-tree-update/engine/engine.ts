import {
  approach, bezier, clamp, ctx2d, easeInOutCubic, easeOutBack, easeOutCubic, makeCanvas, mulberry32, smoothstep,
} from "./math";
import { LIGHT_COLORS, pickWeighted, rgba } from "./palette";
import { glowSprite, identityFor, renderOrnament, type OrnamentIdentity, type Sprite } from "./ornaments";
import { DEFAULT_TREE, halfWidthAt, ornamentSlots, renderTree, type LightPoint, type TreeGeometry } from "./tree";
import { pack, wrapText } from "./text";

/** Minimal shape the engine needs. Matches PublicWish from the app. */
export interface EngineWish {
  id: string;
  message: string;
  name: string | null;
  seed: number;
}

export interface EngineOptions {
  fonts: { serif: string; sans: string };
  geometry?: Partial<TreeGeometry>;
  /** "black" removes the scene backdrop — for projecting onto a physical surface. */
  background?: "scene" | "black";
  showUi?: boolean;
  showCards?: boolean;
  title?: string;
  subtitle?: string;
  qr?: { image: CanvasImageSource; label: string[] } | null;
  quality?: "high" | "medium" | "low";
  reducedMotion?: boolean;
  maxPixelRatio?: number;
}

export const LOGICAL_W = 1920;
export const LOGICAL_H = 1080;

interface Orn {
  wish: EngineWish;
  id: OrnamentIdentity;
  slot: number;
  x: number;
  y: number;
  r: number;
  state: "waiting" | "flying" | "placed" | "leaving";
  t: number; // time entered current state
  delay: number;
  highlight: number;
  sprite: Sprite | null;
  spriteR: number;
  landedAt: number;
}

interface Flight {
  orn: Orn;
  t0: number;
  dur: number;
  p: [number, number][];
  caption: boolean;
  lastTrail: number;
}

interface Card {
  orn: Orn;
  side: -1 | 1;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  anchorY: number; // offset from card top to leader anchor
  y: number;
  ty: number;
  alpha: number;
  talpha: number;
  delay: number;
  dead: boolean;
  fontKey: string;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; rgb: [number, number, number]; drag: number;
}

interface Flake { x: number; y: number; z: number; r: number; sway: number; phase: number; speed: number }
interface Light { p: LightPoint; rgb: [number, number, number]; sprite: HTMLCanvasElement; phase: number; speed: number; size: number }

const CAPTION_IN = 0.7;
const CAPTION_HOLD = 2.6;
const FLIGHT_DUR = 2.5;
const ROTATE_EVERY = 13;
const CARD_GAP = 22;
const CARD_MAX_W = 430;

export class WishTreeEngine {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: Required<Omit<EngineOptions, "geometry" | "qr">> & { qr: EngineOptions["qr"] };
  private g: TreeGeometry;
  private px = 1; // device pixels per logical unit

  private bg: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private tree: HTMLCanvasElement | null = null;
  private treeLights: LightPoint[] = [];
  private slots: { x: number; y: number }[] = [];
  private lights: Light[] = [];
  private glow = new Map<string, HTMLCanvasElement>();
  private starCore: HTMLCanvasElement | null = null;

  private orns = new Map<string, Orn>();
  private slotUsed = new Set<number>();
  private flights: Flight[] = [];
  private arrivalQueue: Orn[] = [];
  private nextArrivalAt = 0;
  private caption: { orn: Orn; t0: number; canvas: HTMLCanvasElement; w: number; h: number; dur: number } | null = null;
  private cards = new Map<string, Card>();
  private cardCache = new Map<string, Card>();
  private lastShown = new Map<string, number>();
  private pinned = new Map<string, number>();
  private nextRotate = [0, 0];
  private layoutDirty = true;
  private relayoutAt = 0;
  private particles: Particle[] = [];
  private rings: { x: number; y: number; t0: number; rgb: [number, number, number] }[] = [];
  private flakes: Flake[] = [];
  private dust: Flake[] = [];
  private shine = 0; // 0..1, grows with wish count
  private sparkleBoost = 0;
  private count = 0;
  private targetR = 22;

  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private initialised = false;
  private fontsVersion = 0;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas;
    this.ctx = ctx2d(canvas);
    this.opts = {
      background: "scene",
      showUi: true,
      showCards: true,
      title: "The Christmas Wish Tree",
      subtitle: "Every wish makes the tree shine brighter.",
      quality: "high",
      reducedMotion: false,
      maxPixelRatio: 2,
      ...options,
      qr: options.qr ?? null,
    };
    this.g = { ...DEFAULT_TREE, ...(options.geometry ?? {}) };
    this.slots = ornamentSlots(this.g);
    this.initParticles();
  }

  // ───────────────────────────── Public API ─────────────────────────────

  /** Resize the backing store. `cssW/cssH` is the on-screen size of the 16:9 canvas. */
  resize(cssW: number, cssH: number, dpr = window.devicePixelRatio || 1) {
    const ratio = Math.min(dpr, this.opts.maxPixelRatio);
    const qualityCap = this.opts.quality === "low" ? 0.6 : this.opts.quality === "medium" ? 0.85 : 1;
    const w = Math.round(clamp(cssW * ratio * qualityCap, 640, 3840));
    const px = w / LOGICAL_W;
    if (Math.abs(px - this.px) < 0.01 && this.tree) return;
    this.px = px;
    this.canvas.width = w;
    this.canvas.height = Math.round(LOGICAL_H * px);
    this.buildStatic();
    for (const o of this.orns.values()) o.sprite = null;
    for (const c of this.cards.values()) this.renderCard(c);
  }

  setOptions(partial: Partial<EngineOptions>) {
    const geometryChanged = partial.geometry !== undefined;
    Object.assign(this.opts, partial);
    if (geometryChanged) {
      this.g = { ...DEFAULT_TREE, ...(partial.geometry ?? {}) };
      this.slots = ornamentSlots(this.g);
      for (const o of this.orns.values()) {
        const s = this.slots[o.slot % this.slots.length];
        o.x = s.x; o.y = s.y;
      }
    }
    if (geometryChanged || partial.background !== undefined) this.buildStatic();
    if (partial.fonts) this.refreshFonts();
    this.layoutDirty = true;
  }

  /** Call after web fonts finish loading so cached text is re-rendered with them. */
  refreshFonts() {
    this.fontsVersion++;
    for (const c of this.cards.values()) this.renderCard(c);
    if (this.caption) this.caption = { ...this.caption, ...this.renderCaption(this.caption.orn.wish) };
  }

  /**
   * Reconcile with the authoritative list of approved wishes (oldest first).
   * New wishes fly in; removed ones fade away. The first call places
   * everything quietly with a gentle staggered reveal.
   */
  setWishes(list: EngineWish[]) {
    const incoming = new Set(list.map((w) => w.id));
    const first = !this.initialised;
    this.initialised = true;

    for (const [id, o] of this.orns) {
      if (!incoming.has(id) && o.state !== "leaving") {
        o.state = "leaving";
        o.t = this.time;
        this.arrivalQueue = this.arrivalQueue.filter((a) => a !== o);
        this.flights = this.flights.filter((f) => f.orn !== o);
        if (this.caption?.orn === o) this.caption = null;
        const card = this.cards.get(id);
        if (card) card.talpha = 0;
      }
    }

    let reveal = 0;
    for (const w of list) {
      const existing = this.orns.get(w.id);
      if (existing) {
        if (existing.state === "leaving") {
          // Re-approved while fading out: bring it straight back.
          existing.state = "placed";
          existing.t = this.time;
        }
        if (existing.wish.message !== w.message || existing.wish.name !== w.name) {
          existing.wish = w;
          const c = this.cards.get(w.id);
          if (c) this.renderCard(c);
        }
        continue;
      }
      const slot = this.claimSlot();
      const s = this.slots[slot % this.slots.length];
      const o: Orn = {
        wish: w,
        id: identityFor(w.seed),
        slot,
        x: s.x,
        y: s.y,
        r: this.targetR,
        state: first ? "placed" : "waiting",
        t: this.time,
        delay: first ? 0.4 + reveal++ * Math.min(0.06, 3 / Math.max(1, list.length)) : 0,
        highlight: 0,
        sprite: null,
        spriteR: 0,
        landedAt: first ? -100 : 0,
      };
      this.orns.set(w.id, o);
      if (!first) this.arrivalQueue.push(o);
    }

    this.updateCount();
    this.layoutDirty = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.time += dt;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.orns.clear();
    this.cards.clear();
  }

  get wishCount() {
    return this.count;
  }

  // ───────────────────────────── Setup ─────────────────────────────

  private buildStatic() {
    const W = LOGICAL_W, H = LOGICAL_H, px = this.px, g = this.g;

    // Background
    this.bg = makeCanvas(W * px, H * px);
    const b = ctx2d(this.bg);
    b.scale(px, px);
    if (this.opts.background === "black") {
      b.fillStyle = "#000";
      b.fillRect(0, 0, W, H);
    } else {
      const sky = b.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#020806");
      sky.addColorStop(0.55, "#04110c");
      sky.addColorStop(1, "#071a12");
      b.fillStyle = sky;
      b.fillRect(0, 0, W, H);
      const halo = b.createRadialGradient(g.cx, g.top + (g.base - g.top) * 0.55, 50, g.cx, g.top + (g.base - g.top) * 0.55, 760);
      halo.addColorStop(0, "rgba(40, 96, 70, 0.42)");
      halo.addColorStop(0.5, "rgba(22, 60, 44, 0.18)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = halo;
      b.fillRect(0, 0, W, H);
      // Distant bokeh
      const r = mulberry32(99);
      b.globalCompositeOperation = "lighter";
      for (let i = 0; i < 46; i++) {
        const x = r() * W, y = r() * H * 0.85;
        if (Math.abs(x - g.cx) < g.halfWidth * 0.9 && y > g.top) continue;
        const rad = 18 + r() * 70;
        const c = r() < 0.12 ? [190, 70, 70] : r() < 0.5 ? [226, 184, 102] : [244, 228, 188];
        const gr = b.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.05 + r() * 0.06})`);
        gr.addColorStop(0.7, `rgba(${c[0]},${c[1]},${c[2]},${0.02 + r() * 0.03})`);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        b.fillStyle = gr;
        b.beginPath();
        b.arc(x, y, rad, 0, Math.PI * 2);
        b.fill();
      }
      b.globalCompositeOperation = "source-over";
    }
    // Floor glow + soft reflection under the tree
    const floor = b.createRadialGradient(g.cx, g.base + 30, 10, g.cx, g.base + 30, g.halfWidth * 1.5);
    floor.addColorStop(0, "rgba(226, 184, 102, 0.20)");
    floor.addColorStop(0.4, "rgba(226, 184, 102, 0.06)");
    floor.addColorStop(1, "rgba(0,0,0,0)");
    b.fillStyle = floor;
    b.save();
    b.translate(g.cx, g.base + 30);
    b.scale(1, 0.22);
    b.translate(-g.cx, -(g.base + 30));
    b.fillRect(g.cx - g.halfWidth * 1.6, g.base - 400, g.halfWidth * 3.2, 900);
    b.restore();

    // Vignette
    this.vignette = makeCanvas(W * px, H * px);
    const v = ctx2d(this.vignette);
    v.scale(px, px);
    if (this.opts.background !== "black") {
      const vg = v.createRadialGradient(W / 2, H * 0.48, H * 0.35, W / 2, H * 0.5, H * 1.05);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.72)");
      v.fillStyle = vg;
      v.fillRect(0, 0, W, H);
    }

    // Tree
    const t = renderTree(g, px, W, H);
    this.tree = t.canvas;
    this.treeLights = t.lights;

    // Glow sprites
    this.glow.clear();
    for (const c of LIGHT_COLORS) this.glow.set(c.rgb.join(","), glowSprite(c.rgb));

    // Fairy lights
    const lr = mulberry32(31);
    this.lights = this.treeLights.slice(0, 420).map((p) => {
      const c = pickWeighted(LIGHT_COLORS, lr());
      return { p, rgb: c.rgb, sprite: this.glow.get(c.rgb.join(","))!, phase: lr() * Math.PI * 2, speed: 0.6 + lr() * 2.2, size: 0.7 + lr() * 0.8 };
    });

    // Tree-top star core
    this.starCore = this.buildStar(px);
  }

  private buildStar(px: number): HTMLCanvasElement {
    const R = 34, size = R * 2 + 8;
    const c = makeCanvas(size * px, size * px);
    const x = ctx2d(c);
    x.scale(px, px);
    const cx = size / 2, cy = size / 2;
    const verts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.42 : R;
      verts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    for (let i = 0; i < 10; i++) {
      const [ax, ay] = verts[i], [bx, by] = verts[(i + 1) % 10];
      const mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - cy;
      const l = (-mx * 0.6 - my * 0.8) / Math.hypot(mx, my);
      x.fillStyle = l > 0.2 ? "#fff3cf" : l > -0.35 ? "#f0c66e" : "#a8762a";
      x.beginPath();
      x.moveTo(cx, cy);
      x.lineTo(ax, ay);
      x.lineTo(bx, by);
      x.closePath();
      x.fill();
    }
    const core = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = core;
    x.beginPath();
    x.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    x.fill();
    return c;
  }

  private initParticles() {
    const n = this.opts.quality === "low" ? 110 : this.opts.quality === "medium" ? 170 : 240;
    const r = mulberry32(5);
    this.flakes = Array.from({ length: n }, () => {
      const z = 0.15 + Math.pow(r(), 1.6) * 0.85;
      return { x: r() * LOGICAL_W, y: r() * LOGICAL_H, z, r: 0.7 + z * z * 2.6, sway: 8 + r() * 26, phase: r() * 6.28, speed: 14 + z * 46 };
    });
    this.dust = Array.from({ length: 70 }, () => ({
      x: 0, y: r() * LOGICAL_H, z: r(), r: 0.6 + r() * 1.4, sway: 6 + r() * 14, phase: r() * 6.28, speed: 6 + r() * 14,
    }));
  }

  private claimSlot(): number {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slotUsed.has(i)) {
        this.slotUsed.add(i);
        return i;
      }
    }
    const i = this.slots.length + this.slotUsed.size;
    this.slotUsed.add(i);
    return i;
  }

  private updateCount() {
    let n = 0;
    for (const o of this.orns.values()) if (o.state !== "leaving") n++;
    this.count = n;
    // Ornament radius shrinks gracefully as the tree fills.
    const area = this.g.halfWidth * (this.g.base - this.g.top) * 0.8;
    this.targetR = clamp(0.36 * Math.sqrt(area / Math.max(1, n)), 6, 23);
  }

  // ───────────────────────────── Update ─────────────────────────────

  private update(dt: number) {
    const now = this.time;
    this.shine = approach(this.shine, smoothstep(0, 60, this.count), 0.8, dt);
    this.sparkleBoost = approach(this.sparkleBoost, 0, 1.6, dt);

    // Arrivals
    if (this.arrivalQueue.length && now >= this.nextArrivalAt) {
      const o = this.arrivalQueue.shift()!;
      const backlog = this.arrivalQueue.length;
      const withCaption = backlog < 3 && !this.caption && this.opts.showCards;
      this.launch(o, withCaption);
      this.nextArrivalAt = now + (withCaption ? CAPTION_IN + CAPTION_HOLD * 0.75 : backlog > 8 ? 0.25 : 0.6);
    }

    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const t = (now - f.t0) / f.dur;
      if (t < 0) continue;
      const e = easeInOutCubic(clamp(t, 0, 1));
      const x = bezier(f.p[0][0], f.p[1][0], f.p[2][0], f.p[3][0], e);
      const y = bezier(f.p[0][1], f.p[1][1], f.p[2][1], f.p[3][1], e);
      f.orn.x = x;
      f.orn.y = y;
      if (now - f.lastTrail > 0.016) {
        f.lastTrail = now;
        for (let k = 0; k < 2; k++) {
          this.particles.push({
            x, y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30 + 10,
            life: 0, max: 0.6 + Math.random() * 0.7, size: 1 + Math.random() * 2.2,
            rgb: f.orn.id.color.glow, drag: 1.5,
          });
        }
      }
      if (t >= 1) {
        this.flights.splice(i, 1);
        this.land(f.orn);
      }
    }

    // Ornament easing
    for (const [key, o] of this.orns) {
      o.r = approach(o.r, this.targetR * o.id.sizeMul, 2.5, dt);
      if (o.state === "placed") {
        const s = this.slots[o.slot % this.slots.length];
        o.x = approach(o.x, s.x, 4, dt);
        o.y = approach(o.y, s.y, 4, dt);
      }
      const card = this.cards.get(key);
      o.highlight = approach(o.highlight, card && card.talpha > 0 ? 1 : 0, 3, dt);
      if (o.state === "leaving" && now - o.t > 1.2) {
        this.orns.delete(key);
        this.slotUsed.delete(o.slot);
        this.cards.delete(key);
        this.cardCache.delete(key);
        this.lastShown.delete(key);
        this.pinned.delete(key);
        this.updateCount();
        this.layoutDirty = true;
      }
    }

    // Cards
    if (this.opts.showCards) {
      for (const side of [-1, 1] as const) {
        const si = side < 0 ? 0 : 1;
        if (now >= this.nextRotate[si]) {
          this.nextRotate[si] = now + ROTATE_EVERY + si * 4.5;
          this.layoutSide(side, true);
        }
      }
      if (this.relayoutAt && now >= this.relayoutAt) {
        this.relayoutAt = 0;
        this.layoutDirty = true;
      }
      if (this.layoutDirty) {
        this.layoutDirty = false;
        this.layoutSide(-1, false);
        this.layoutSide(1, false);
      }
    }
    for (const [key, c] of this.cards) {
      if (c.delay > 0 && c.talpha > 0) { c.delay -= dt; continue; }
      c.alpha = approach(c.alpha, c.talpha, c.talpha > c.alpha ? 2.6 : 8, dt);
      c.y = approach(c.y, c.ty, 3.2, dt);
      if (c.talpha > 0) this.lastShown.set(key, now);
      if (c.talpha === 0 && c.alpha < 0.01) this.cards.delete(key);
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.vy += 6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.rings = this.rings.filter((r) => now - r.t0 < 1.4);

    const motion = this.opts.reducedMotion ? 0.3 : 1;
    for (const f of this.flakes) {
      f.y += f.speed * dt * motion;
      f.x += Math.sin(now * 0.4 + f.phase) * f.sway * dt * 0.6 * motion;
      if (f.y > LOGICAL_H + 10) { f.y = -10; f.x = Math.random() * LOGICAL_W; }
      if (f.x < -20) f.x = LOGICAL_W + 10;
      if (f.x > LOGICAL_W + 20) f.x = -10;
    }
    for (const d of this.dust) {
      d.y -= d.speed * dt * motion;
      if (d.y < this.g.top || d.x === 0) {
        d.y = this.g.base - Math.random() * 120;
        const w = halfWidthAt(this.g, d.y) * 1.1;
        d.x = this.g.cx + (Math.random() * 2 - 1) * w;
      }
    }
  }

  private launch(o: Orn, withCaption: boolean) {
    const now = this.time;
    const slot = this.slots[o.slot % this.slots.length];
    let start: [number, number];
    let t0 = now;
    if (withCaption) {
      const cap = this.renderCaption(o.wish);
      this.caption = { orn: o, t0: now, ...cap, dur: CAPTION_IN + CAPTION_HOLD + 0.8 };
      start = [LOGICAL_W / 2, 1030 - cap.h - 6];
      t0 = now + CAPTION_IN + CAPTION_HOLD * 0.55;
    } else {
      start = [this.g.cx + (Math.random() - 0.5) * 900, LOGICAL_H + 30];
    }
    o.state = "flying";
    o.t = now;
    o.x = start[0];
    o.y = start[1];
    const dir = slot.x < this.g.cx ? -1 : 1;
    this.flights.push({
      orn: o,
      t0,
      dur: FLIGHT_DUR,
      caption: withCaption,
      lastTrail: 0,
      p: [
        start,
        [start[0] - dir * (160 + Math.random() * 200), start[1] - 260],
        [slot.x + dir * (220 + Math.random() * 120), slot.y - 40 - Math.random() * 140],
        [slot.x, slot.y],
      ],
    });
  }

  private land(o: Orn) {
    o.state = "placed";
    o.t = this.time;
    o.landedAt = this.time;
    this.sparkleBoost = 1;
    this.rings.push({ x: o.x, y: o.y, t0: this.time, rgb: o.id.color.glow });
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 160;
      this.particles.push({
        x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.7 + Math.random() * 0.9,
        size: 0.8 + Math.random() * 2, rgb: i % 3 ? o.id.color.glow : [255, 246, 228], drag: 3,
      });
    }
    this.pinned.set(o.wish.id, this.time + 25);
    this.lastShown.delete(o.wish.id);
    this.layoutDirty = true;
  }

  // ───────────────────────────── Cards ─────────────────────────────

  private region(side: -1 | 1): { x: number; min: number; max: number } {
    const inner = side < 0 ? this.g.cx - this.g.halfWidth - 40 : this.g.cx + this.g.halfWidth + 40;
    if (side < 0) return { x: inner, min: this.opts.showUi ? 215 : 70, max: 968 }; // room for the credit plaque
    return { x: inner, min: 80, max: this.opts.qr ? 845 : 1035 };
  }

  /**
   * Chooses which wishes get a text card on one side of the tree and packs them
   * vertically so nothing overlaps and leader lines never cross. When there
   * are more wishes than fit, `rotate` brings the least-recently-shown ones in.
   */
  private layoutSide(side: -1 | 1, rotate: boolean) {
    const now = this.time;
    const reg = this.region(side);
    const capacity = reg.max - reg.min;
    const candidates: Orn[] = [];
    for (const o of this.orns.values()) {
      if (o.state !== "placed") continue;
      if (now - o.t < o.delay) {
        // Still in its reveal: lay out again once it has appeared.
        const ready = o.t + o.delay + 0.05;
        this.relayoutAt = this.relayoutAt ? Math.min(this.relayoutAt, ready) : ready;
        continue;
      }
      const s = this.slots[o.slot % this.slots.length];
      if ((s.x < this.g.cx ? -1 : 1) === side) candidates.push(o);
    }

    const visible = (o: Orn) => (this.cards.get(o.wish.id)?.talpha ?? 0) > 0;
    const isPinned = (o: Orn) => (this.pinned.get(o.wish.id) ?? 0) > now;
    const seen = (o: Orn) => this.lastShown.get(o.wish.id) ?? -1;
    const byStale = (a: Orn, b: Orn) => seen(a) - seen(b) || a.slot - b.slot;

    const pinned = candidates.filter(isPinned).sort((a, b) => b.landedAt - a.landedAt);
    const rest = candidates.filter((o) => !isPinned(o));
    let order: Orn[];
    if (rotate) {
      const hidden = rest.filter((o) => !visible(o)).sort(byStale);
      if (!hidden.length) return; // everything already fits
      order = [...pinned, ...hidden, ...rest.filter(visible).sort(byStale)];
    } else {
      order = [...pinned, ...rest.filter(visible).sort((a, b) => a.slot - b.slot), ...rest.filter((o) => !visible(o)).sort(byStale)];
    }

    const chosen: Card[] = [];
    let used = 0;
    for (const o of order) {
      if (capacity - used < 48) break;
      const c = this.cards.get(o.wish.id) ?? this.cardFor(o, side);
      if (c.side !== side) {
        c.side = side;
        this.renderCard(c);
      }
      const need = c.h + (chosen.length ? CARD_GAP : 0);
      if (used + need > capacity) continue;
      used += need;
      chosen.push(c);
    }
    const chosenIds = new Set(chosen.map((c) => c.orn.wish.id));

    let fadeOut = false;
    for (const [id, c] of this.cards) {
      if (c.side === side && !chosenIds.has(id) && c.talpha > 0) {
        c.talpha = 0;
        fadeOut = true;
      }
    }

    chosen.sort((a, b) => this.slots[a.orn.slot % this.slots.length].y - this.slots[b.orn.slot % this.slots.length].y);
    const ys = pack(
      chosen.map((c) => ({ ideal: this.slots[c.orn.slot % this.slots.length].y - c.anchorY, h: c.h })),
      reg.min, reg.max, CARD_GAP,
    );
    chosen.forEach((c, i) => {
      const fresh = !this.cards.has(c.orn.wish.id) || c.talpha === 0;
      c.ty = ys[i];
      if (fresh) {
        c.y = ys[i];
        c.alpha = 0;
        c.delay = fadeOut ? 0.85 + i * 0.1 : i * 0.05;
      } else if (fadeOut && Math.abs(c.y - c.ty) > 1) {
        // Hold position until outgoing cards have faded, so text never overlaps.
        c.delay = Math.max(c.delay, 0.8);
      }
      c.talpha = 1;
      this.cards.set(c.orn.wish.id, c);
    });
  }

  private cardFor(o: Orn, side: -1 | 1): Card {
    const cached = this.cardCache.get(o.wish.id);
    if (cached) {
      if (cached.fontKey !== this.cardKey() || cached.side !== side) {
        cached.side = side;
        this.renderCard(cached);
      }
      return cached;
    }
    const c: Card = {
      orn: o, side, canvas: makeCanvas(1, 1), w: 0, h: 0, anchorY: 0,
      y: 0, ty: 0, alpha: 0, talpha: 0, delay: 0, dead: false, fontKey: "",
    };
    this.renderCard(c);
    this.cardCache.set(o.wish.id, c);
    return c;
  }

  private cardKey() {
    return `${this.fontsVersion}:${this.px}`;
  }

  private renderCard(c: Card) {
    const { serif, sans } = this.opts.fonts;
    const msg = c.orn.wish.message;
    const size = msg.length > 90 ? 23 : msg.length > 50 ? 25 : 28;
    const lineH = size * 1.22;
    const m = ctx2d(makeCanvas(2, 2));
    m.font = `italic 400 ${size}px ${serif}`;
    const lines = wrapText(m, `“${msg}”`, CARD_MAX_W, 4);
    const nameSize = 14;
    const hasName = Boolean(c.orn.wish.name);
    const w = Math.ceil(Math.max(...lines.map((l) => m.measureText(l).width), 40)) + 24;
    const h = Math.ceil(lines.length * lineH + (hasName ? nameSize + 14 : 0) + 12);
    const px = this.px;
    const canvas = makeCanvas(w * px, h * px);
    const x = ctx2d(canvas);
    x.scale(px, px);
    x.textBaseline = "alphabetic";
    const align: CanvasTextAlign = c.side < 0 ? "right" : "left";
    const tx = c.side < 0 ? w - 12 : 12;
    x.textAlign = align;
    x.shadowColor = "rgba(0, 0, 0, 0.85)";
    x.shadowBlur = 12;
    x.font = `italic 400 ${size}px ${serif}`;
    x.fillStyle = "#f7ecd2";
    lines.forEach((l, i) => x.fillText(l, tx, 6 + size + i * lineH - size * 0.18));
    if (hasName) {
      x.font = `500 ${nameSize}px ${sans}`;
      x.fillStyle = "#e2b866";
      if ("letterSpacing" in x) (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "3px";
      x.fillText(`— ${c.orn.wish.name!.toUpperCase()}`, tx, 6 + lines.length * lineH + nameSize + 6);
    }
    c.canvas = canvas;
    c.w = w;
    c.h = h;
    c.anchorY = 6 + size * 0.62;
    c.fontKey = this.cardKey();
  }

  private renderCaption(w: EngineWish) {
    const { serif, sans } = this.opts.fonts;
    const m = ctx2d(makeCanvas(2, 2));
    let size = 44;
    m.font = `italic 400 ${size}px ${serif}`;
    let lines = wrapText(m, `“${w.message}”`, 760, 2);
    if (lines.length > 2 || lines[lines.length - 1].endsWith("…")) {
      size = 34;
      m.font = `italic 400 ${size}px ${serif}`;
      lines = wrapText(m, `“${w.message}”`, 780, 3);
    }
    const lineH = size * 1.18;
    const labelH = 26;
    const nameH = w.name ? 30 : 0;
    const width = 820, height = Math.ceil(labelH + lines.length * lineH + nameH + 18);
    const px = this.px;
    const canvas = makeCanvas(width * px, height * px);
    const x = ctx2d(canvas);
    x.scale(px, px);
    x.textAlign = "center";
    x.shadowColor = "rgba(0,0,0,0.9)";
    x.shadowBlur = 16;
    const ls = (v: string) => { if ("letterSpacing" in x) (x as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = v; };
    x.font = `500 13px ${sans}`;
    ls("6px");
    x.fillStyle = "#e2b866";
    x.fillText("✦  A NEW WISH  ✦", width / 2, 16);
    ls("0px");
    x.font = `italic 400 ${size}px ${serif}`;
    x.fillStyle = "#fbf3df";
    lines.forEach((l, i) => x.fillText(l, width / 2, labelH + size * 0.95 + i * lineH));
    if (w.name) {
      x.font = `500 16px ${sans}`;
      ls("4px");
      x.fillStyle = "#e2b866";
      x.fillText(`— ${w.name.toUpperCase()}`, width / 2, labelH + lines.length * lineH + 24);
    }
    return { canvas, w: width, h: height };
  }

  // ───────────────────────────── Draw ─────────────────────────────

  private draw() {
    const ctx = this.ctx;
    const px = this.px;
    const W = LOGICAL_W, H = LOGICAL_H;
    const now = this.time;
    const g = this.g;
    if (!this.bg || !this.tree || !this.vignette || !this.starCore) return;

    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, W, H);

    this.drawSnow(false);

    // Tree with a slow, subtle breathing glow behind it
    const breathe = 0.5 + 0.5 * Math.sin(now * 0.5);
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(g.cx, g.top + (g.base - g.top) * 0.6, 0, g.cx, g.top + (g.base - g.top) * 0.6, g.halfWidth * 1.6);
    const ha = 0.05 + this.shine * 0.07 + breathe * 0.02 + this.sparkleBoost * 0.05;
    halo.addColorStop(0, `rgba(255, 196, 120, ${ha})`);
    halo.addColorStop(1, "rgba(255, 196, 120, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(g.cx - g.halfWidth * 1.7, g.top - 200, g.halfWidth * 3.4, g.base - g.top + 400);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.tree, 0, 0, W, H);

    this.drawLights();
    this.drawLeaders();
    this.drawOrnaments();
    this.drawStar();
    this.drawEffects();
    if (this.opts.showCards) {
      this.drawCards();
      this.drawCaption();
    }
    if (this.opts.showUi) this.drawUi();
    this.drawSnow(true);
    ctx.drawImage(this.vignette, 0, 0, W, H);
  }

  private drawSnow(front: boolean) {
    const ctx = this.ctx;
    const dot = this.glow.get(LIGHT_COLORS[1].rgb.join(","));
    if (!dot) return;
    for (const f of this.flakes) {
      const isFront = f.z > 0.86;
      if (isFront !== front) continue;
      const r = isFront ? f.r * 2.6 : f.r * 2.2;
      ctx.globalAlpha = isFront ? 0.22 : 0.18 + f.z * 0.55;
      ctx.drawImage(dot, f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawLights() {
    const ctx = this.ctx;
    const now = this.time;
    const n = Math.round(150 + this.shine * 270);
    ctx.globalCompositeOperation = "lighter";
    const boost = 1 + this.sparkleBoost * 0.6;
    for (let i = 0; i < Math.min(n, this.lights.length); i++) {
      const l = this.lights[i];
      const tw = 0.55 + 0.45 * Math.sin(now * l.speed + l.phase);
      const a = (0.35 + 0.65 * tw) * (0.5 + l.p.depth * 0.5) * boost;
      const s = (10 + l.size * 9) * (0.85 + tw * 0.3);
      ctx.globalAlpha = clamp(a * 0.75, 0, 1);
      ctx.drawImage(l.sprite, l.p.x - s / 2, l.p.y - s / 2, s, s);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = rgba([255, 248, 230], 1);
      ctx.fillRect(l.p.x - 0.8, l.p.y - 0.8, 1.6, 1.6);
    }

    // Two strands of tiny lights spiralling around the tree, with a soft chase.
    const g = this.g;
    const warm = this.glow.get(LIGHT_COLORS[0].rgb.join(","))!;
    for (let strand = 0; strand < 2; strand++) {
      const turns = 4.2;
      const steps = 190;
      for (let i = 0; i < steps; i++) {
        const u = i / steps;
        const y = g.top + 60 + u * (g.base - g.top - 80);
        const phase = u * turns * Math.PI * 2 + strand * Math.PI;
        const facing = Math.cos(phase);
        if (facing < -0.15) continue;
        const x = g.cx + halfWidthAt(g, y) * 0.86 * Math.sin(phase);
        const yy = y + facing * 10;
        const chase = 0.5 + 0.5 * Math.sin(now * 2.2 - u * 60 + strand);
        const a = (0.25 + 0.75 * chase) * smoothstep(-0.15, 0.4, facing) * (0.6 + this.shine * 0.4);
        ctx.globalAlpha = a * 0.6;
        ctx.drawImage(warm, x - 7, yy - 7, 14, 14);
        ctx.globalAlpha = a;
        ctx.fillStyle = "#fff4dc";
        ctx.fillRect(x - 0.7, yy - 0.7, 1.4, 1.4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private ornAlpha(o: Orn): number {
    const age = this.time - o.t;
    if (o.state === "leaving") return clamp(1 - age / 1.1, 0, 1);
    if (o.state === "placed" && o.delay) return smoothstep(o.delay, o.delay + 0.8, age);
    return 1;
  }

  private drawLeaders() {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    for (const c of this.cards.values()) {
      if (c.alpha < 0.01) continue;
      const o = c.orn;
      const reg = this.region(c.side);
      const ax = reg.x + c.side * -4;
      const ay = c.y + c.anchorY;
      const ox = o.x + (c.side < 0 ? -o.r * 1.2 : o.r * 1.2);
      const oy = o.y;
      const fresh = clamp(1 - (this.time - o.landedAt) / 20, 0, 1);
      const a = c.alpha * this.ornAlpha(o) * (0.3 + fresh * 0.35);
      const grad = ctx.createLinearGradient(ax, ay, ox, oy);
      grad.addColorStop(0, `rgba(226, 184, 102, ${a})`);
      grad.addColorStop(1, `rgba(243, 212, 139, ${a * 0.55})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      const midX = ax + (ox - ax) * 0.45;
      ctx.bezierCurveTo(midX, ay, midX, oy, ox, oy);
      ctx.stroke();
      // Diamond marker at the text end
      ctx.fillStyle = `rgba(226, 184, 102, ${c.alpha * 0.9})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 3.5);
      ctx.lineTo(ax + 3.5, ay);
      ctx.lineTo(ax, ay + 3.5);
      ctx.lineTo(ax - 3.5, ay);
      ctx.closePath();
      ctx.fill();
    }
  }

  private spriteFor(o: Orn): Sprite {
    // Render at a quantised radius and scale at draw time to avoid re-rendering every frame.
    const bucket = Math.max(6, Math.ceil(o.r / 2) * 2);
    if (!o.sprite || o.spriteR !== bucket) {
      o.sprite = renderOrnament(o.id, bucket, this.px * 1.25, o.wish.seed);
      o.spriteR = bucket;
    }
    return o.sprite;
  }

  private drawOrnaments() {
    const ctx = this.ctx;
    const now = this.time;
    const list = [...this.orns.values()].filter((o) => o.state === "placed" || o.state === "leaving" || o.state === "flying");
    // Draw lower ornaments last so they overlap naturally.
    list.sort((a, b) => a.y - b.y);

    for (const o of list) {
      if (o.state === "flying") {
        const f = this.flights.find((fl) => fl.orn === o);
        if (f && now < f.t0) {
          // Waiting under the caption: a gently pulsing orb.
          const t = clamp((now - o.t) / CAPTION_IN, 0, 1);
          this.drawGlow(o.x, o.y, (24 + Math.sin(now * 4) * 4) * easeOutCubic(t), o.id.color.glow, 0.9 * t);
          continue;
        }
      }
      const alpha = this.ornAlpha(o);
      if (alpha <= 0) continue;

      let scale = 1;
      if (o.state === "placed" && o.landedAt > 0) {
        const t = clamp((now - o.landedAt) / 0.8, 0, 1);
        scale = 0.3 + 0.7 * easeOutBack(t);
      }
      if (o.state === "flying") scale = 0.55;
      if (o.state === "leaving") scale = 1 - easeInOutCubic(clamp((now - o.t) / 1.1, 0, 1)) * 0.6;

      const id = o.id;
      const tw = 0.5 + 0.5 * Math.sin(now * id.twinkleSpeed + id.twinklePhase);
      const r = o.r * scale;
      const glowA = (0.28 + tw * 0.32 + o.highlight * 0.25) * alpha * (id.kind === "orb" ? 1.6 : 1);
      this.drawGlow(o.x, o.y, r * (id.kind === "orb" ? 4.2 : 3.2) * (1 + o.highlight * 0.2), id.color.glow, glowA);

      const sp = this.spriteFor(o);
      const k = r / sp.r;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(o.x, o.y);
      if (id.kind === "bauble" || id.kind === "crystal") {
        // Hang from the thread and sway very slightly.
        const pivotY = -sp.ay * k;
        ctx.translate(0, pivotY);
        ctx.rotate(Math.sin(now * id.swaySpeed + id.swayPhase) * 0.045);
        ctx.translate(0, -pivotY);
      } else if (id.kind === "star") {
        ctx.rotate(Math.sin(now * id.swaySpeed * 0.5 + id.swayPhase) * 0.12);
      }
      ctx.drawImage(sp.canvas, -sp.ax * k, -sp.ay * k, sp.w * k, sp.h * k);
      ctx.restore();

      // Occasional starburst glint
      const gt = (now + id.glintOffset) % id.glintEvery;
      if (gt < 0.6 && o.state === "placed") {
        const ga = Math.sin((gt / 0.6) * Math.PI) * alpha;
        this.drawGlint(o.x - r * 0.35, o.y - r * 0.4, r * 1.6, ga);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawGlow(x: number, y: number, size: number, rgb: [number, number, number], alpha: number) {
    const key = rgb.join(",");
    let s = this.glow.get(key);
    if (!s) { s = glowSprite(rgb); this.glow.set(key, s); }
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(s, x - size, y - size, size * 2, size * 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  private drawGlint(x: number, y: number, len: number, alpha: number) {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    for (const [dx, dy, l] of [[1, 0, 1], [0, 1, 1], [0.7, 0.7, 0.45], [0.7, -0.7, 0.45]] as const) {
      const gr = ctx.createLinearGradient(x - dx * len * l, y - dy * len * l, x + dx * len * l, y + dy * len * l);
      gr.addColorStop(0, "rgba(255,250,235,0)");
      gr.addColorStop(0.5, `rgba(255,250,235,${alpha})`);
      gr.addColorStop(1, "rgba(255,250,235,0)");
      ctx.strokeStyle = gr;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - dx * len * l, y - dy * len * l);
      ctx.lineTo(x + dx * len * l, y + dy * len * l);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawStar() {
    const ctx = this.ctx;
    const g = this.g;
    const now = this.time;
    const x = g.cx, y = g.top - 4;
    const intensity = 0.75 + this.shine * 0.5 + this.sparkleBoost * 0.35 + Math.sin(now * 1.3) * 0.05;

    this.drawGlow(x, y, 120 * intensity, [255, 214, 150], 0.55);
    this.drawGlow(x, y, 46 * intensity, [255, 246, 228], 0.8);

    // Slowly rotating rays
    ctx.globalCompositeOperation = "lighter";
    const rays = 12;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + now * 0.06;
      const len = (i % 2 ? 90 : 160) * intensity * (0.85 + 0.15 * Math.sin(now * 0.9 + i));
      const gr = ctx.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
      gr.addColorStop(0, `rgba(255, 236, 190, ${0.32 * intensity})`);
      gr.addColorStop(1, "rgba(255, 236, 190, 0)");
      ctx.strokeStyle = gr;
      ctx.lineWidth = i % 2 ? 1 : 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    const s = this.starCore!;
    const size = 76 * (0.96 + Math.sin(now * 1.3) * 0.02);
    ctx.drawImage(s, x - size / 2, y - size / 2, size, size);
  }

  private drawEffects() {
    const ctx = this.ctx;
    const now = this.time;
    ctx.globalCompositeOperation = "lighter";
    // Rising gold dust
    for (const d of this.dust) {
      const fl = 0.5 + 0.5 * Math.sin(now * 2 + d.phase);
      const fade = smoothstep(this.g.top, this.g.top + 200, d.y);
      this.ctx.globalAlpha = 0.5 * fl * fade;
      ctx.fillStyle = "#ffd98f";
      ctx.fillRect(d.x + Math.sin(now * 0.7 + d.phase) * d.sway, d.y, d.r, d.r);
    }
    for (const p of this.particles) {
      const t = p.life / p.max;
      const a = (1 - t) * (1 - t);
      const s = p.size * (1 + t);
      this.drawGlow(p.x, p.y, s * 3, p.rgb, a * 0.8);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fffaf0";
      ctx.fillRect(p.x - s / 3, p.y - s / 3, (s * 2) / 3, (s * 2) / 3);
    }
    for (const r of this.rings) {
      const t = (now - r.t0) / 1.4;
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = rgba(r.rgb, 1);
      ctx.lineWidth = 1.5 * (1 - t) + 0.3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + easeOutCubic(t) * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Flight heads
    for (const f of this.flights) {
      if (now < f.t0) continue;
      this.drawGlow(f.orn.x, f.orn.y, 34, f.orn.id.color.glow, 0.9);
      this.drawGlow(f.orn.x, f.orn.y, 12, [255, 255, 255], 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private drawCards() {
    const ctx = this.ctx;
    for (const c of this.cards.values()) {
      if (c.alpha < 0.01) continue;
      const reg = this.region(c.side);
      const slide = (1 - c.alpha) * 18 * c.side * -1;
      const x = c.side < 0 ? reg.x - 14 - c.w + slide : reg.x + 14 - slide;
      ctx.globalAlpha = c.alpha * this.ornAlpha(c.orn);
      ctx.drawImage(c.canvas, x, c.y, c.w, c.h);
    }
    ctx.globalAlpha = 1;
  }

  private drawCaption() {
    const cap = this.caption;
    if (!cap) return;
    const t = this.time - cap.t0;
    if (t > cap.dur) { this.caption = null; return; }
    const a = smoothstep(0, CAPTION_IN, t) * (1 - smoothstep(cap.dur - 0.9, cap.dur, t));
    const ctx = this.ctx;
    const y = 1040 - cap.h + (1 - easeOutCubic(clamp(t / CAPTION_IN, 0, 1))) * 14;
    // Soft dark scrim for legibility over the tree base
    const scrim = ctx.createRadialGradient(LOGICAL_W / 2, y + cap.h / 2, 20, LOGICAL_W / 2, y + cap.h / 2, 640);
    scrim.addColorStop(0, `rgba(2, 8, 6, ${0.88 * a})`);
    scrim.addColorStop(0.55, `rgba(2, 8, 6, ${0.6 * a})`);
    scrim.addColorStop(1, "rgba(2, 8, 6, 0)");
    ctx.fillStyle = scrim;
    ctx.save();
    ctx.translate(LOGICAL_W / 2, y + cap.h / 2);
    ctx.scale(1, 0.32);
    ctx.fillRect(-660, -660, 1320, 1320);
    ctx.restore();
    ctx.globalAlpha = a;
    ctx.drawImage(cap.canvas, (LOGICAL_W - cap.w) / 2, y, cap.w, cap.h);
    ctx.globalAlpha = 1;
  }

  private drawUi() {
    const ctx = this.ctx;
    const { serif, sans } = this.opts.fonts;
    const ls = (v: string) => { if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = v; };
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fbf3df";
    ctx.font = `400 48px ${serif}`;
    ctx.fillText(this.opts.title, 72, 104);
    ctx.font = `italic 400 24px ${serif}`;
    ctx.fillStyle = "rgba(244, 228, 188, 0.7)";
    ctx.fillText(this.opts.subtitle, 74, 140);
    ctx.shadowBlur = 0;
    const lg = ctx.createLinearGradient(74, 0, 330, 0);
    lg.addColorStop(0, "rgba(226,184,102,0.8)");
    lg.addColorStop(1, "rgba(226,184,102,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(74, 160, 256, 1);
    ctx.font = `500 13px ${sans}`;
    ls("4px");
    ctx.fillStyle = "#e2b866";
    const n = this.count;
    ctx.fillText(`${n} ${n === 1 ? "WISH" : "WISHES"} SHINING`, 74, 188);
    ls("0px");

    const qr = this.opts.qr;
    if (qr) {
      const size = 150, x = LOGICAL_W - 72 - size, y = LOGICAL_H - 56 - size;
      ctx.fillStyle = "#f4e4bc";
      ctx.shadowColor = "rgba(226,184,102,0.35)";
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.roundRect(x - 10, y - 10, size + 20, size + 20, 14);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.drawImage(qr.image, x, y, size, size);
      ctx.textAlign = "right";
      ctx.font = `italic 400 26px ${serif}`;
      ctx.fillStyle = "#fbf3df";
      qr.label.forEach((l, i) => ctx.fillText(l, x - 28, y + size / 2 - 6 + i * 30));
      ctx.font = `500 11px ${sans}`;
      ls("4px");
      ctx.fillStyle = "#e2b866";
      ctx.fillText("SCAN WITH YOUR CAMERA", x - 28 + 4, y + size / 2 + qr.label.length * 30 + 6);
      ls("0px");
      ctx.textAlign = "left";
    }
    ctx.shadowColor = "transparent";
  }
}
