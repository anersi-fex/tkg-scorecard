-- Scorecard, migration 0002 (2026-10-27): the carrier a sale was written with.
-- Paste into the Supabase SQL editor once, BEFORE merging the app update that uses it. Safe to run twice.
-- The Log a sale screen asks for the carrier (AHL, AmAm, Americo, Foresters, Newbridge, Royal, UHL;
-- the owner edits the list in Settings) instead of the client's first name. The old `client`
-- column stays, unused by the screens.

alter table sales add column if not exists carrier text check (carrier is null or char_length(carrier) <= 40);

notify pgrst, 'reload schema';
