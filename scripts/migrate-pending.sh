#!/usr/bin/env sh
# Applies only the migrations this database is missing, in order, each in
# one transaction. Safe to run twice: the second run skips everything.
#
#   DATABASE_URL='postgres://postgres:<pw>@localhost:5432/rentio' sh scripts/migrate-pending.sh
#
# On the Coolify box the database is not published; run it there, e.g.
#   docker exec -i rentio-db sh -c 'cat > /tmp/m.sql' < supabase/migrations/<file>
# or open an SSH tunnel to 5432 and point DATABASE_URL at it.
#
# Each line below names a migration and a query that prints t once it is
# applied. Add new migrations at the bottom with their own marker.
set -eu
: "${DATABASE_URL:?set DATABASE_URL}"
cd "$(dirname "$0")/.."

applied() { psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select ($1)"; }

apply() {
  if [ "$(applied "$2")" = "t" ]; then
    echo "skip  $1"
  else
    echo "apply $1"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "supabase/migrations/$1"
  fi
}

apply 20261028002100_confirm_payment.sql \
  "exists (select 1 from pg_proc where proname = 'confirm_payment')"
apply 20261028002200_nightly_job.sql \
  "exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'late_fee_warnings')"
apply 20261028002300_record_and_void_payment.sql \
  "exists (select 1 from pg_proc where proname = 'apply_payment')"
apply 20261111000100_tenants_cannot_read_drafts.sql \
  "exists (select 1 from pg_policy where polname = 'invoices_select' and pg_get_expr(polqual, polrelid) like '%borrador%')"
apply 20261111000200_create_lease.sql \
  "exists (select 1 from pg_proc where proname = 'create_lease')"
apply 20261111000300_last_admin_and_append_only_log.sql \
  "exists (select 1 from pg_trigger where tgname = 'profiles_zz_keep_one_admin')"
apply 20261112000100_notifications.sql \
  "exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notifications')"
apply 20261112000200_nightly_per_org.sql \
  "exists (select 1 from pg_proc p where proname = 'nightly' and pg_get_functiondef(p.oid) like '%orgs_failed%')"

echo "done"
