-- Scorecard, migration 0006 (2026-11-12): the CRM. Every logged policy keeps its details (status,
-- the policy's own fields, the client's details and beneficiaries) and a history of changes; a
-- third kind of person (manager); an upline a joiner picked waits to be confirmed.
-- Run once BEFORE the app update that uses it. Safe to run twice (a second run changes no role).
-- It only adds: no row and no column is removed, and the only rows it changes are the source of
-- older sales (named from their own note and logged_by) and, on the first run, who is a manager.
--
-- Owner, 2026-11-12: "tracked ... similar to how a CRM would track things ... easily filterable and
-- very easy to sort, find, and search"; "a normal agent, which will be most people ... a manager
-- ... typically the ones that have teams ... Admins ... likely just myself and Jack".

-- Managers. The FIRST run (sales.status does not exist yet) makes every active member who leads an
-- active person a manager. A later run changes nobody's role: by then an admin decides who is one.
-- (The app that is live while this runs reads an unknown role as a member, so the minutes between
-- this paste and the deploy are safe.)
alter table agents drop constraint if exists agents_role_check;
alter table agents add constraint agents_role_check check (role in ('owner', 'admin', 'manager', 'member'));
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'status') then
    update agents a set role = 'manager'
     where a.role = 'member' and a.active
       and exists (select 1 from agents d where d.upline_id = a.id and d.active and d.id <> a.id);
  end if;
end $$;

-- An upline a joiner picked on the agency link waits for that upline (a manager above them, or an
-- admin) to confirm it. Everyone already on the board is confirmed.
alter table agents add column if not exists upline_confirmed boolean not null default true;

-- A policy's details. Every column may be empty: older sales, the Shortcut's and the AgentSpace day
-- totals have none of them. premium_cents stays the annual premium the board counts.
alter table sales add column if not exists status text;
alter table sales add column if not exists monthly_cents bigint;
alter table sales add column if not exists effective_date date;
alter table sales add column if not exists rate_class text;
alter table sales add column if not exists coverage_cents bigint;
alter table sales add column if not exists ss_benefit boolean;
alter table sales add column if not exists billing_cycle text;
alter table sales add column if not exists billing_day text;
alter table sales add column if not exists policy_number text;
alter table sales add column if not exists application_number text;
alter table sales add column if not exists lead_source text;
alter table sales add column if not exists notes text;
alter table sales add column if not exists underwriting boolean not null default false;
-- The client (seen only by the seller, the confirmed uplines above them and the admins: the app
-- reads these columns in one file, src/lib/policies.ts).
alter table sales add column if not exists client_first text;
alter table sales add column if not exists client_last text;
alter table sales add column if not exists client_dob date;
alter table sales add column if not exists client_email text;
alter table sales add column if not exists client_no_email boolean not null default false;
alter table sales add column if not exists client_phone text;
alter table sales add column if not exists client_address text;
alter table sales add column if not exists beneficiaries jsonb not null default '[]'::jsonb;
alter table sales add column if not exists updated_at timestamptz;
alter table sales add column if not exists source text not null default 'scorecard';

-- Checks (dropped first, so a second run puts the same ones back).
alter table sales drop constraint if exists sales_status_check;
alter table sales add constraint sales_status_check check (status is null or status in ('Submitted', 'Underwriting', 'Approved', 'Issued', 'Declined', 'Cancelled'));
alter table sales drop constraint if exists sales_source_check;
alter table sales add constraint sales_source_check check (source in ('scorecard', 'import', 'shortcut'));
alter table sales drop constraint if exists sales_monthly_check;
alter table sales add constraint sales_monthly_check check (monthly_cents is null or (monthly_cents > 0 and monthly_cents <= 100000000));
alter table sales drop constraint if exists sales_coverage_check;
alter table sales add constraint sales_coverage_check check (coverage_cents is null or (coverage_cents >= 0 and coverage_cents <= 100000000000));
alter table sales drop constraint if exists sales_beneficiaries_check;
alter table sales add constraint sales_beneficiaries_check check (jsonb_typeof(beneficiaries) = 'array' and jsonb_array_length(beneficiaries) <= 10 and char_length(beneficiaries::text) <= 2000);
alter table sales drop constraint if exists sales_text_lengths_check;
alter table sales add constraint sales_text_lengths_check check (
  coalesce(char_length(rate_class), 0) <= 40
  and coalesce(char_length(billing_cycle), 0) <= 40
  and coalesce(char_length(billing_day), 0) <= 40
  and coalesce(char_length(policy_number), 0) <= 60
  and coalesce(char_length(application_number), 0) <= 60
  and coalesce(char_length(lead_source), 0) <= 60
  and coalesce(char_length(notes), 0) <= 2000
  and coalesce(char_length(client_first), 0) <= 60
  and coalesce(char_length(client_last), 0) <= 60
  and coalesce(char_length(client_email), 0) <= 120
  and coalesce(char_length(client_phone), 0) <= 30
  and coalesce(char_length(client_address), 0) <= 200
);

-- Where each older sale came from: the AgentSpace day totals by their note, the Shortcut's by logged_by.
update sales set source = 'import' where note like 'AgentSpace import%' and source <> 'import';
update sales set source = 'shortcut' where logged_by = 'shortcut' and source = 'scorecard';

-- A policy's history: one line per change. Never a client's value (the app writes the lines).
create table if not exists sale_events (
  id bigint generated always as identity primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  at timestamptz not null default now(),
  -- The person whose own sign-in made the change (a plain column, like sales.logged_by_agent).
  by_agent uuid,
  -- owner, team or shortcut when no person did it.
  by_label text check (by_label is null or by_label in ('owner', 'team', 'shortcut')),
  what text not null check (char_length(what) between 1 and 200)
);
create index if not exists sale_events_sale_idx on sale_events (sale_id, at);

-- The CRM's lists: a person's policies by day, and by status.
create index if not exists sales_agent_day_idx on sales (agent_id, sold_on);
create index if not exists sales_status_idx on sales (status);

alter table sale_events enable row level security;

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
