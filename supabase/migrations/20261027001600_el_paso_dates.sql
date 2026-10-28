-- Dates are El Paso dates. current_date was the server's UTC date, so every
-- evening after 6pm Mountain time a receipt due "today" read as overdue,
-- new receipts and payments defaulted to tomorrow, and the §92.019 late-fee
-- guard opened hours early. Matches APP_TIMEZONE in src/lib/format.ts.
-- ponytail: one zone for the platform; per-org zones when a client leaves Mountain time.
do $$
begin
  execute format('alter database %I set timezone = %L', current_database(), 'America/Denver');
end;
$$;
