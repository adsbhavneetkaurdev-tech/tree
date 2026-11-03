-- ═══════════════════════════════════════════════════════════════════════════
--  The Christmas Wish Tree — Supabase schema
--  Run this once in the Supabase SQL editor (or `supabase db push`).
--  Safe to re-run: every statement is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

do $$ begin
  create type public.wish_status as enum ('pending', 'approved', 'rejected', 'archived');
exception when duplicate_object then null; end $$;

-- ─── Wishes ────────────────────────────────────────────────────────────────
create table if not exists public.wishes (
  id           uuid primary key default gen_random_uuid(),
  message      text not null check (char_length(btrim(message)) between 1 and 140),
  name         text check (name is null or char_length(name) <= 40),
  status       public.wish_status not null default 'pending',
  -- Random seed that gives every wish its own ornament shape, colour and twinkle.
  seed         integer not null default floor(random() * 2147483647)::integer,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);

create index if not exists wishes_status_approved_idx on public.wishes (status, approved_at);
create index if not exists wishes_created_idx on public.wishes (created_at desc);

-- ─── Singleton display state ───────────────────────────────────────────────
-- `version` is bumped on every change to `wishes`. Displays and the admin
-- dashboard subscribe to this one row over Supabase Realtime and refetch
-- when it changes. This avoids relying on RLS-filtered change events, which
-- cannot tell a public client that a wish was *un*-approved.
create table if not exists public.tree_state (
  id            integer primary key default 1 check (id = 1),
  version       bigint not null default 0,
  auto_approve  boolean not null default false,
  reset_at      timestamptz,
  updated_at    timestamptz not null default now()
);
insert into public.tree_state (id) values (1) on conflict (id) do nothing;

-- ─── Triggers ──────────────────────────────────────────────────────────────
create or replace function public.wishes_set_approved_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_at := now();
  end if;
  return new;
end $$;

drop trigger if exists wishes_set_approved_at on public.wishes;
create trigger wishes_set_approved_at
  before insert or update of status on public.wishes
  for each row execute function public.wishes_set_approved_at();

create or replace function public.bump_tree_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tree_state set version = version + 1, updated_at = now() where id = 1;
  return null;
end $$;

drop trigger if exists wishes_bump_version on public.wishes;
create trigger wishes_bump_version
  after insert or update or delete on public.wishes
  for each statement execute function public.bump_tree_version();

-- ─── Row Level Security ────────────────────────────────────────────────────
-- The browser (anon key) can only ever READ approved wishes and the display
-- state. All writes go through the Next.js API using the service-role key,
-- which validates, rate-limits and enforces moderation.
alter table public.wishes enable row level security;
alter table public.tree_state enable row level security;

drop policy if exists "Public can read approved wishes" on public.wishes;
create policy "Public can read approved wishes"
  on public.wishes for select to anon, authenticated
  using (status = 'approved');

drop policy if exists "Public can read tree state" on public.tree_state;
create policy "Public can read tree state"
  on public.tree_state for select to anon, authenticated
  using (true);

-- ─── Table privileges ──────────────────────────────────────────────────────
-- Newer Supabase projects no longer grant table access to the API roles by
-- default. Grant it explicitly (RLS above still limits what anon can see).
grant usage on schema public to anon, authenticated, service_role;
grant select on public.wishes, public.tree_state to anon, authenticated;
grant select, insert, update, delete on public.wishes, public.tree_state to service_role;

-- ─── Realtime ──────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.tree_state;
exception when duplicate_object then null; end $$;
