# The Christmas Wish Tree

*Every wish makes the tree shine brighter.*

A live, interactive Christmas installation. Guests scan a QR code, send a wish from their phone, and watch it fly across the room onto a glowing, animated evergreen projected on the wall.

| Surface | Route | Who uses it |
|---|---|---|
| **Guest submission site** | `/` | Guests, on their phones (from the QR code) |
| **Tree display** | `/display` | The projector / big screen (fullscreen 16:9) |
| **Admin dashboard** | `/admin` | Moderators (password-protected) |
| **Printable QR card** | `/qr` | Print for tables, signage, the bar |

Built with **Next.js 16 (App Router) · React 19 · Supabase (Postgres + Realtime) · Canvas 2D**.

---

## 1. Quick start (5 minutes, no database needed)

The app runs out of the box in **local demo mode**: wishes go to a JSON file (`.data/wish-tree.json`) and live updates use Server-Sent Events. Use this to try everything before you set up Supabase.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local` and set at least `ADMIN_PASSWORD`, then:

```bash
npm run dev
```

Open these in three windows:

- http://localhost:3000: submit a wish (try it in your browser's mobile emulator)
- http://localhost:3000/admin: sign in, approve it (or turn on **Auto-approve**)
- http://localhost:3000/display: watch it fly onto the tree. Press **F** for fullscreen.

> Local demo mode is for development and single-machine use only. For a real event, and for any serverless host such as Vercel, use Supabase (below).

---

## 2. Supabase setup

1. Create a project at [supabase.com](https://supabase.com) (the free tier is plenty for an event).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It's safe to re-run. It creates:
   - `wishes`: every submission, with `status` = `pending | approved | rejected | archived` and a random `seed` that gives each ornament its unique look.
   - `tree_state`: one row holding a `version` counter (bumped by a trigger on every change), the `auto_approve` flag and `reset_at`.
   - **Row Level Security**: the public (anon) key can only *read approved wishes* and `tree_state`. It cannot insert, update or delete anything.
   - Adds `tree_state` to the `supabase_realtime` publication.
3. In **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only**; never expose it)
4. Put them in `.env.local` and restart `npm run dev`. The admin dashboard header will now show **Supabase** instead of **Local demo store**.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | for Supabase mode | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for Supabase mode | Browser key for the Realtime subscription (read-only by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | for Supabase mode | Server-side writes (submissions, moderation) |
| `ADMIN_PASSWORD` | **yes** | Admin dashboard password |
| `ADMIN_SESSION_SECRET` | recommended | 32+ random characters used to sign admin cookies (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_GUEST_URL` | recommended in production | Public URL of the guest site, encoded in the QR code. Defaults to the current host |
| `APP_ROLE` | optional | `all` (default), `guest` or `display`. See [Deployment](#4-deployment) |

---

## 3. How it works

```
 Guest phone ──POST /api/wishes──▶ Next.js API ──service role──▶ Supabase Postgres
                                   (validate, rate-limit,             │  trigger bumps
                                    honeypot, auto-approve?)          ▼  tree_state.version
                                                                Supabase Realtime
 Admin ──PATCH/DELETE /api/admin/*──▶ Next.js API ──▶ Postgres       │
                                                                     ▼
 Display ◀──GET /api/wishes (approved only)◀── refetch on every version change
```

- **Real-time:** the display and the admin dashboard subscribe to the single `tree_state` row. Any change to `wishes` bumps its version, and clients refetch. This is deliberately simpler and more robust than streaming row changes: RLS-filtered change events can't tell a public client that a wish was *un*-approved, but a version bump always can. A 15-second safety poll and a refresh on tab focus cover dropped connections.
- **Latency:** measured end-to-end in testing, *approve → ornament on the display* took about 0.2 s, and *24 simultaneous submissions → all on the display* took about 0.6 s. Both are well inside the 2-second target.
- **Concurrency:** each submission is a single `INSERT`. Postgres handles simultaneous guests natively; in local mode, writes are serialised through a queue.
- **Persistence:** wishes live in the database, so refreshing or restarting the display restores the whole tree instantly, without replaying the fly-in animations.
- **Moderation:** with **Auto-approve off** (the default), wishes wait in *Pending* until approved. With it **on**, they go straight to the tree. Only `approved` wishes are ever returned publicly.
- **Reset display:** archives every approved wish, so the tree empties with a fade. Nothing is deleted; restore wishes from the *Archived* tab.
- **Abuse protection:** length limits (140 / 40 chars), control-character stripping, a hidden honeypot field, and rate limits of 4 wishes/minute per device and 120/minute per IP. The per-IP limit is generous because venue Wi-Fi often puts every guest behind one address.

### Project structure

```
app/
  (guest)/            Guest submission site: page, form, confirmation animation
  display/            Projector page: engine host, realtime, fullscreen, calibration
  admin/              Login + moderation dashboard
  qr/                 Printable QR card
  api/
    wishes/           GET approved (public) · POST submit (public)
    stream/           SSE change feed (local mode only)
    admin/            login · wishes · wishes/[id] · reset · settings
engine/               Framework-agnostic visual engine (no React)
  engine.ts           Render loop, wish lifecycle, flights, card layout, particles
  tree.ts             Procedural evergreen + ornament slot sampling
  ornaments.ts        Per-wish identity (shape, colour, finish, twinkle) + sprites
  projection.ts       Corner-pin homography for projection mapping
  text.ts             Text wrapping + 1-D non-overlap packing
lib/
  server/             Store interface, Supabase + local stores, auth, rate limit
  realtime-client.ts  Supabase Realtime / SSE subscription with fallbacks
supabase/schema.sql   Database schema, triggers, RLS, realtime
proxy.ts              APP_ROLE route gating (guest vs display deployments)
```

---

## 4. Deployment

### Option A: one deployment (simplest)

1. Push this folder to a GitHub repository.
2. On [Vercel](https://vercel.com/new), import the repo (framework preset: **Next.js**).
3. Add the environment variables from the table above (Supabase is required on Vercel).
4. Deploy. Your URLs are `https://your-app.vercel.app/` (guests), `/display` and `/admin`.
5. Set `NEXT_PUBLIC_GUEST_URL` to the guest URL (or a custom domain) and redeploy, so the QR code is stable.

### Option B: separate guest and display applications (recommended for events)

The guest site and the display/admin site can be deployed as **two separate applications** from the same repository, each locked to its role by `proxy.ts`:

| Project | Domain (example) | `APP_ROLE` | Exposes |
|---|---|---|---|
| Guest | `wish.example.com` | `guest` | `/` and `POST /api/wishes` only. Every other path redirects to `/` |
| Display | `tree.example.com` | `display` | `/display`, `/admin`, `/qr` and their APIs. `POST /api/wishes` is refused |

Create two Vercel projects from the same repo with the same Supabase variables, set `APP_ROLE` on each, and set `NEXT_PUBLIC_GUEST_URL=https://wish.example.com` on the display project so its QR code points at the guest site. The guest app's public surface is tiny, and the admin dashboard isn't even routable from the domain guests use.

### Other hosts

Any Node 20+ host works (Render, Railway, Fly.io, a venue laptop):

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

`next start` listens on `PORT` (default 3000). Local demo mode works on a single long-running server, such as a laptop at the venue, but Supabase is still recommended.

---

## 5. Running the event

**Before guests arrive**

1. Open `/admin` on a laptop or phone. Choose **Auto-approve** (fast and magical) or manual moderation (safer for public events).
2. Print `/qr` (one card per table works well). The display also shows the QR code in its corner.
3. On the projector machine, open `/display` in Chrome and press **F** for fullscreen. For an unattended kiosk:
   ```bash
   google-chrome --kiosk --autoplay-policy=no-user-gesture-required https://tree.example.com/display
   ```
   The page requests a screen wake-lock and hides the cursor after 3 seconds.
4. Send a test wish from your phone, check it arrives, then use **Reset display** to start the evening with an empty tree.

**Display keyboard shortcuts:** `F` fullscreen · `C` projection calibration · `Q` show/hide QR · double-click also toggles fullscreen. Move the mouse to see the status bar (connection state and approved count).

**Display URL options** (combine with `&`):

| Parameter | Effect |
|---|---|
| `?qr=0` | Hide the QR code |
| `?ui=0` | Hide the title and wish counter |
| `?cards=0` | Ornaments only, no wish text |
| `?bg=black` | Pure black background: for projecting onto a physical tree, wall or façade, where black emits no light |
| `?quality=medium` / `low` | Lower render resolution and fewer particles for older machines |
| `?tree=cx,top,base,halfWidth` | Move or resize the tree in the 1920×1080 space, e.g. `?tree=960,120,960,420` |

---

## 6. Projection mapping

The visual engine (`engine/`) is plain TypeScript with no React or Next.js dependency, and renders into a fixed **1920×1080 logical space** regardless of the output resolution. This keeps it portable to physical installations:

- **Keystone / corner-pin:** press **C** on the display and drag the four corners onto your surface. A perspective homography is applied as a CSS `matrix3d` (no quality loss) and saved per device.
- **Physical alignment:** `?tree=` moves the tree silhouette to match a real tree or architectural feature. Ornament slots, lights and text columns all follow.
- **Black-level mode:** `?bg=black` removes the backdrop and vignette so only the tree, ornaments and text emit light.
- **Feeding media servers:** `canvas.captureStream(60)` on the display canvas gives a live video track. Send it via OBS/NDI/Spout to Resolume, MadMapper, TouchDesigner or disguise for warping, blending and multi-projector setups.
- **Embedding elsewhere:** `new WishTreeEngine(canvas, { fonts }).setWishes([...])` is the whole API, so it can run in Electron or a standalone page with any data source.

---

## 7. Testing checklist

These were all verified end-to-end in a headless browser against a production build:

- [x] Guest submits from a mobile viewport → confirmation animation → wish appears in admin *Pending* instantly
- [x] Wrong admin password rejected; correct password signs in; admin APIs return 401 without a session
- [x] Approve → ornament flies onto the display with the *“A new wish”* caption in about 0.2 s
- [x] Auto-approve + 24 simultaneous submissions → all on the tree in about 0.6 s, captions queued and staggered
- [x] Display refresh restores all wishes without re-animating
- [x] *Remove from tree* and *Delete* remove ornaments live; *Reset display* empties the tree and archives wishes
- [x] 160+ wishes: ornaments shrink and fill evenly; text cards rotate through all wishes with no overlap
- [x] `APP_ROLE=guest` / `display` route gating
- [x] `schema.sql` applied twice to PostgreSQL 16 (idempotent); triggers set `approved_at` and bump `version`; the anon role can read only approved rows and cannot insert

---

## 8. Design notes

- **Palette:** deep evergreen `#06140f`, warm gold `#e2b866`, champagne `#f4e4bc`, ivory `#fbf6ea`, with restrained red `#a8303a`.
- **Type:** Cormorant Garamond (display, wishes) and Jost (labels), via `next/font`.
- **The tree** is procedurally painted once at startup: roughly 1,000 depth-sorted branches with tens of thousands of individually shaded needles, tiered like a Nordmann fir, with frost highlights and volume shading. Fairy lights, spiral light strands, the star, snow and gold dust are animated live.
- **Each wish's ornament** is derived from its seed: glass bauble (gloss, banded, dotted or frosted), faceted star (5, 6 or 8 points), crystal drop or glowing orb, in one of six metallic colours, each with its own twinkle rhythm, sway and occasional glint.
- **Layout:** ornaments take slots from a farthest-point sequence, so any number of wishes is evenly spread. Text cards sit in columns beside the tree, joined by fine gold leader lines. They're stacked in the same vertical order as their ornaments so they never overlap and the lines stay untangled, and they rotate gracefully when there are more wishes than space.
- **The tree shines brighter** as wishes arrive: more fairy lights, a stronger star and a warmer halo.
