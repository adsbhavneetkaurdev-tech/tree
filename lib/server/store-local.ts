import "server-only";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import type { TreeState, Wish, WishCounts, WishStatus } from "@/lib/types";
import { toPublic, type WishStore } from "./store";

/**
 * Zero-config store used when Supabase isn't configured. Persists to
 * .data/wish-tree.json and pushes change events over Server-Sent Events.
 * Intended for local development and single-server demos only.
 */
interface FileShape {
  wishes: Wish[];
  state: TreeState;
}

const DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "wish-tree.json");

class LocalStore implements WishStore {
  readonly kind = "local" as const;
  readonly events = new EventEmitter();
  private data: FileShape | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.events.setMaxListeners(1000);
  }

  private async load(): Promise<FileShape> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await fs.readFile(FILE, "utf8")) as FileShape;
    } catch {
      this.data = { wishes: [], state: { version: 0, auto_approve: false, reset_at: null } };
    }
    return this.data;
  }

  /** Serialise every mutation so simultaneous submissions never clobber each other. */
  private mutate<T>(fn: (d: FileShape) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const d = await this.load();
      const result = fn(d);
      d.state.version += 1;
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(d));
      await fs.rename(tmp, FILE);
      this.events.emit("change", d.state.version);
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async listApproved() {
    const d = await this.load();
    return d.wishes
      .filter((w) => w.status === "approved")
      .sort((a, b) => (a.approved_at ?? "").localeCompare(b.approved_at ?? ""))
      .map(toPublic);
  }

  async listAll(status: WishStatus | "all" = "all") {
    const d = await this.load();
    return d.wishes
      .filter((w) => status === "all" || w.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 1000);
  }

  async counts(): Promise<WishCounts> {
    const d = await this.load();
    const c: WishCounts = { total: d.wishes.length, pending: 0, approved: 0, rejected: 0, archived: 0 };
    for (const w of d.wishes) c[w.status]++;
    return c;
  }

  create(message: string, name: string | null) {
    return this.mutate((d) => {
      const now = new Date().toISOString();
      const approved = d.state.auto_approve;
      const wish: Wish = {
        id: randomUUID(),
        message,
        name,
        status: approved ? "approved" : "pending",
        seed: randomInt(0, 2147483647),
        created_at: now,
        approved_at: approved ? now : null,
      };
      d.wishes.push(wish);
      return wish;
    });
  }

  setStatus(id: string, status: WishStatus) {
    return this.mutate((d) => {
      const w = d.wishes.find((x) => x.id === id);
      if (!w) return null;
      if (status === "approved" && w.status !== "approved") w.approved_at = new Date().toISOString();
      w.status = status;
      return { ...w };
    });
  }

  remove(id: string) {
    return this.mutate((d) => {
      const before = d.wishes.length;
      d.wishes = d.wishes.filter((w) => w.id !== id);
      return d.wishes.length !== before;
    });
  }

  resetDisplay() {
    return this.mutate((d) => {
      let n = 0;
      for (const w of d.wishes) if (w.status === "approved") { w.status = "archived"; n++; }
      d.state.reset_at = new Date().toISOString();
      return n;
    });
  }

  async getState() {
    return { ...(await this.load()).state };
  }

  setAutoApprove(value: boolean) {
    return this.mutate((d) => {
      d.state.auto_approve = value;
      return { ...d.state, version: d.state.version + 1 };
    });
  }
}

const g = globalThis as unknown as { __wishTreeLocalStore?: LocalStore };
export function getLocalStore(): LocalStore {
  return (g.__wishTreeLocalStore ??= new LocalStore());
}
