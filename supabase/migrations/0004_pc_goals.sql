-- Scorecard, migration 0004 (2026-11-04): P&C goals.
-- Paste into the Supabase SQL editor once, BEFORE merging the app update that uses it. Safe to run twice.
-- The goal the board measures is life (owner, 2026-11-04); P&C gets a goal of its own ("it does not
-- have goals like the life insurance does. I want this to be able to have a goal as well"): the
-- team's P&C goal for a month, and each person's, next to the life goals already there.

alter table goals add column if not exists pc_cents bigint not null default 0;
alter table goals drop constraint if exists goals_pc_cents_check;
alter table goals add constraint goals_pc_cents_check check (pc_cents >= 0 and pc_cents <= 100000000000);
alter table agent_goals add column if not exists pc_cents bigint not null default 0;
alter table agent_goals drop constraint if exists agent_goals_pc_cents_check;
alter table agent_goals add constraint agent_goals_pc_cents_check check (pc_cents >= 0 and pc_cents <= 100000000000);

notify pgrst, 'reload schema';
