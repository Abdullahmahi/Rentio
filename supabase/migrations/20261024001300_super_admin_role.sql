-- PortfolioAI staff: a role that spans every organization.
--
-- Its own file because a new enum value cannot be used in the transaction
-- that adds it, and the next migration uses it.

alter type public.user_role add value if not exists 'super_admin';
