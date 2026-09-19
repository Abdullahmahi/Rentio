-- ============================================================================
-- Rentio — remove hand-inserted demo auth rows.
--
-- This file used to CREATE the demo logins by inserting into auth.users
-- directly. That does not work: GoTrue owns that table's shape and scans
-- several columns into non-nullable Go types, so a hand-written row makes
-- every sign-in on the project fail with
--
--     "Database error querying schema"
--
-- and the Admin API cannot even delete the row afterwards, because deleting
-- loads the user first ("Database error loading user"). SQL is the only way
-- out once such a row exists.
--
-- So: this script now only CLEANS UP. Create the logins with
--
--     bun run db:demo-logins
--
-- which goes through the Admin API and lets GoTrue write its own rows.
-- ============================================================================

delete from auth.users
where email in (
  'admin@rentio.mx',
  'gerente@rentio.mx',
  'maria.fernanda@example.mx',
  'ana.sofia@example.mx',
  'emiliano.rivas@example.mx'
);

-- profiles.id references auth.users on delete cascade, so the profile rows
-- go with them and `bun run db:demo-logins` recreates both.

select count(*) as remaining_demo_users
from auth.users
where email like '%@rentio.mx' or email like '%@example.mx';
