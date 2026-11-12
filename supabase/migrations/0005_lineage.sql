-- Scorecard, migration 0005 (2026-11-12): Lineage Financial. People get their own sign-in, an
-- upline (teams), an "in the office" mark and a role; join links; approvals; who logged a sale.
-- Run once BEFORE the app update that uses it. Safe to run twice (a second run changes no role).
-- It only adds: no row and no column is removed or changed.
--
-- Owner, 2026-11-12: "I would like everyone to be able to join ... send everyone something, and
-- it automatically makes them sign up for the first time and edit their information"; "the ones
-- in the office ... their numbers should be showing at the top"; "give Jack ... direct admin
-- control ... if unsure about privileges or permissions, then make it so that that's something
-- that I need to approve".

-- People: the upline (whose team they are on), in the office or not, the role, and a sign-in.
alter table agents add column if not exists upline_id uuid references agents(id) on delete set null;
alter table agents add column if not exists in_office boolean not null default false;
-- The role. The FIRST run (the column is new) also names the app's one owner (Anersi) and the
-- admin who runs the agency (Jack), only when those rows are there. A later run changes nobody's
-- role: by then people have joined under names they typed themselves and the owner may have
-- changed who is an admin, so a name never hands out a level a second time.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'role') then
    alter table agents add column role text not null default 'member';
    update agents set role = 'owner' where id = (select id from agents where name = 'Anersi Koka' order by sort, id limit 1);
    update agents set role = 'admin' where name = 'Jack Gariglio' and role = 'member';
  end if;
end $$;
alter table agents add column if not exists role text not null default 'member';
alter table agents drop constraint if exists agents_role_check;
alter table agents add constraint agents_role_check check (role in ('owner', 'admin', 'member'));
alter table agents drop constraint if exists agents_upline_not_self;
alter table agents add constraint agents_upline_not_self check (upline_id is null or upline_id <> id);
-- The sign-in: a phone number in +1XXXXXXXXXX form (only admins ever see it) and a password hash
-- (scrypt, never the password). session_version: raising it signs that person out everywhere.
alter table agents add column if not exists phone text;
alter table agents drop constraint if exists agents_phone_check;
alter table agents add constraint agents_phone_check check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
create unique index if not exists agents_phone_key on agents (phone) where phone is not null;
alter table agents add column if not exists pass_hash text;
alter table agents add column if not exists session_version integer not null default 1;
alter table agents add column if not exists joined_at timestamptz;
alter table agents add column if not exists last_seen_at timestamptz;
create index if not exists agents_upline_idx on agents (upline_id);

-- Exactly one owner of the app (the first run above set it, by name; after that only by hand).
create unique index if not exists agents_one_owner on agents ((true)) where role = 'owner';

-- Join links. The link holds a random token; only its SHA-256 is stored.
--   agency: anyone with the link signs up (many uses), optionally straight onto one upline's team
--   person: for one person already on the board (one use): they set their own sign-in
--   reset:  a person who forgot their password sets a new one (one use)
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  -- The agency join link itself is kept so an admin can copy it again; person and reset links are not.
  token text check (token is null or kind = 'agency'),
  kind text not null check (kind in ('agency', 'person', 'reset')),
  agent_id uuid references agents(id) on delete cascade,
  upline_id uuid references agents(id) on delete set null,
  created_by uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  used_at timestamptz,
  uses integer not null default 0,
  check (kind = 'agency' or agent_id is not null)
);
create index if not exists invites_agent_idx on invites (agent_id);

-- Approvals: what an admin asked for that waits for the owner's yes.
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 1 and 40),
  -- ids and new values only: never a client's details
  payload jsonb not null default '{}'::jsonb,
  summary text not null default '' check (char_length(summary) <= 200),
  requested_by uuid references agents(id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references agents(id) on delete set null,
  decided_at timestamptz
);
create index if not exists approvals_status_idx on approvals (status, requested_at desc);

-- Who logged a sale, when the session names a person (logged_by keeps the kind of session).
alter table sales add column if not exists logged_by_agent uuid references agents(id) on delete set null;
create index if not exists sales_agent_sold_idx on sales (agent_id, sold_on) where deleted_at is null;

-- The login throttle also counts per account ("acct:<id>" in the same column).
-- (No change needed: ip is free text up to 64 characters.)

alter table invites enable row level security;
alter table approvals enable row level security;

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

notify pgrst, 'reload schema';
