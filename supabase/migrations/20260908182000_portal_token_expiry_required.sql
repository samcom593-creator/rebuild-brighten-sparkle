-- MP-478 — a customer portal token with no expiry never expires.
--
-- billing-portal-redirect is verify_jwt=false: anyone who has the URL can call it.
-- It takes ?t=<uuid>, looks the token up in customer_portal_tokens, and on a hit mints
-- a fresh Stripe billing portal session for that customer and 302-redirects into it —
-- payment methods, invoices, subscriptions. The token is a bearer credential.
--
-- Its expiry check is `if (row.expires_at && new Date(row.expires_at) < new Date())`,
-- which treats a NULL expires_at as "no expiry to enforce" and lets the link through
-- forever. The column was nullable with no default, so the schema permitted exactly the
-- state the code reads as immortal.
--
-- LATENT, not a live leak, and measured as such before this was written: all 4 rows
-- carry an expires_at, all 4 are already expired, none revoked, max use_count 1, last
-- used 2026-06-01, and no writer to this table exists in the repo or in pg_proc. So
-- nothing was exposed. This closes the door at the layer that is not blocked on the
-- Management PAT — the code-side fail-closed fix cannot ship until edge deploys work.
--
-- Applied by hand via bot-sql 2026-09-08 and recorded in schema_migrations; these two
-- statements are idempotent, so a later `supabase db push` re-running them is a no-op.

alter table public.customer_portal_tokens
  alter column expires_at set default (now() + interval '7 days');

alter table public.customer_portal_tokens
  alter column expires_at set not null;
