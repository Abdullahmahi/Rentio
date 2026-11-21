-- A prospect who applied through an application link. Alone in its file:
-- a new enum value cannot be used in the transaction that adds it.
alter type public.user_role add value if not exists 'applicant';
