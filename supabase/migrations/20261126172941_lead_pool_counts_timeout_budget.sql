-- MP-LEAD-COUNTS-BUDGET: the Leads console count RPC (lead_pool_counts) runs 2-8s since
-- 20261126040000_lead_pool_context_preview rewrote its candidate path, and the signed-in
-- API role cancels at 8s (57014 -> HTTP 500 -> the Drop button stays disabled). A function-
-- level statement_timeout is honoured on the API path (proven live 2026-11-26 with a 5s sleep
-- under anon's 3s limit -> HTTP 200), the same mechanism lead_pool_assign already relies on.
-- work_mem keeps the 250k-row DISTINCT ON sorts in memory (they spilled 1,104 temp pages).
--
-- Applied live 2026-11-26 17:29Z through the Supabase MCP apply_migration (which stamps the
-- version this file is named after); this file is the record, see 20261126173149 + the slim
-- count path for the structural fix that brings the call itself under a second.
-- The probe function itself (public._tt_timeout_probe, anon-executable, 5s sleep) was dropped
-- out of band through bot-sql at 17:5xZ the same day: the MCP declines DROP statements, and the
-- repo's anon-definer ratchet (live catalog) refused to commit while it existed. Nothing here
-- recreates it.
alter function public.lead_pool_counts(text, jsonb) set statement_timeout = '30s';
alter function public.lead_pool_counts(text, jsonb) set work_mem = '64MB';
-- v_readymode_ingest_health scans readymode_dialer_calls four times without an imported_at
-- index (p50 5.8s, one 8s timeout today); three of the four become index-only.
create index if not exists idx_rmd_imported_at on public.readymode_dialer_calls using btree (imported_at);
