-- Scorecard, migration 0003 (2026-11-04): P&C alongside life.
-- Paste into the Supabase SQL editor once, BEFORE merging the app update that uses it. Safe to run twice.
-- A sale is life (every row so far) or P&C (`kind`). A person can be marked P&C licensed (the
-- owner, Moe, Maira), which shows the Life / P&C switch on Log a sale for them. Every premium
-- counts toward the goal; the screens split life and P&C.

alter table sales add column if not exists kind text not null default 'life';
alter table sales drop constraint if exists sales_kind_check;
alter table sales add constraint sales_kind_check check (kind in ('life', 'pc'));
alter table agents add column if not exists pc_licensed boolean not null default false;

notify pgrst, 'reload schema';
