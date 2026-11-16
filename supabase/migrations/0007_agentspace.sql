-- Scorecard, migration 0007 (2026-11-16): the AgentSpace live sync.
-- Run once BEFORE the app update that uses it. Safe to run twice. It only adds: no row and no
-- column is removed or changed, and the app that is live while it runs does not read the new column.
--
-- Owner, 2026-11-16: if anybody logs a deal in AgentSpace "by mistake or by habit", it shows up in
-- Scorecard on its own, within minutes, with statuses and premiums kept in step.
--
-- A policy that came from AgentSpace keeps that deal's id, so the sync can find it again, change it
-- when the deal changes and take it off when the deal is gone. A policy logged in Scorecard has no
-- id and is never touched by the sync (unless a deal the sync finds matches it: same seller, same
-- submitted day, same annual premium and the same client name, which links the two instead of
-- counting the sale twice). The sync's own state (when it ran, what it found) is one row in
-- `settings` under its own key, `agentspace_sync`: no table is added.

alter table sales add column if not exists agentspace_deal_id text;

alter table sales drop constraint if exists sales_agentspace_deal_id_check;
alter table sales add constraint sales_agentspace_deal_id_check check (agentspace_deal_id is null or char_length(agentspace_deal_id) between 1 and 64);

-- One policy per AgentSpace deal, even if two runs overlap: the second insert is refused.
create unique index if not exists sales_agentspace_deal_idx on sales (agentspace_deal_id) where agentspace_deal_id is not null;

-- A history line the sync wrote says who wrote it: "AgentSpace sync", not "Shortcut". So the allowed
-- values of sale_events.by_label gain 'agentspace' (the check is put back with its three old values
-- and the new one, so no row that exists can fail it).
alter table sale_events drop constraint if exists sale_events_by_label_check;
alter table sale_events add constraint sale_events_by_label_check check (by_label is null or by_label in ('owner', 'team', 'shortcut', 'agentspace'));

notify pgrst, 'reload schema';
