-- Scorecard, migration 0001 (release 1: the TV board and logging sales).
-- Paste into the Supabase SQL editor once. Safe to run twice.
--
-- Access model: the browser never talks to the database. The app's server code uses the
-- service role key after checking the session (owner or team password). Row Level Security is
-- on for every table with no policies, so the anon and authenticated roles can read and write
-- nothing.
--
-- Privacy: a sale carries the agent, the annual premium, the product and an optional client
-- first name only. No policy numbers, no dates of birth, no contact details.

create extension if not exists pgcrypto;

-- The people on the board. Nobody is deleted: a person who leaves is made inactive and keeps
-- their sales in the history.
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per sale (a policy or a bundle logged at once). Deleted sales stay as rows with
-- deleted_at set, so a mistake can be undone and nothing vanishes from the history silently.
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete restrict,
  -- Annual premium in cents (at most $10,000,000).
  premium_cents bigint not null check (premium_cents >= 0 and premium_cents <= 1000000000),
  policies integer not null default 1 check (policies between 1 and 50),
  product text check (product is null or char_length(product) <= 40),
  -- The client's first name only (optional), so the board can say "Alex sold Maria a policy".
  client text check (client is null or char_length(client) <= 40),
  note text check (note is null or char_length(note) <= 200),
  -- The day it counts for (Detroit date).
  sold_on date not null,
  logged_by text not null default 'team' check (logged_by in ('owner', 'team', 'shortcut')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sales_sold_on_idx on sales (sold_on) where deleted_at is null;
create index if not exists sales_created_idx on sales (created_at desc);

-- The team's goal for a month ("2026-10"), in cents of annual premium.
create table if not exists goals (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  team_cents bigint not null default 0 check (team_cents >= 0 and team_cents <= 100000000000),
  updated_at timestamptz not null default now()
);

-- Each person's own goal for a month (optional; the board shows a bar against it when set).
create table if not exists agent_goals (
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  agent_id uuid not null references agents(id) on delete cascade,
  cents bigint not null default 0 check (cents >= 0 and cents <= 100000000000),
  updated_at timestamptz not null default now(),
  primary key (month, agent_id)
);

-- Key/value settings: "app" holds the board message and the product list.
create table if not exists settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Failed sign-ins, for the login throttle (an IP only, kept short).
create table if not exists login_attempts (
  id bigint generated always as identity primary key,
  ip text not null check (char_length(ip) <= 64),
  at timestamptz not null default now()
);
create index if not exists login_attempts_at_idx on login_attempts (at);

-- Lock every table to the service role (no policies: anon and authenticated get nothing).
alter table agents enable row level security;
alter table sales enable row level security;
alter table goals enable row level security;
alter table agent_goals enable row level security;
alter table settings enable row level security;
alter table login_attempts enable row level security;

-- And take the table grants away from the API roles too, so the public keys get an error, not
-- an empty list.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke execute on all functions in schema public from %I', r);
    end if;
  end loop;
end $$;

-- Supabase's API gateway needs to know about new tables.
notify pgrst, 'reload schema';
