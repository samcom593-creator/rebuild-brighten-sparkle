-- MP-305 (applied live via Supabase MCP 2026-10-28): one row per day of Instagram DM delivery truth.
-- A bot reply row carries no Meta mid (send-instagram-dm only inserts a row on FAILURE), so
-- "delivered" = an outbound row that is neither queued nor carrying an error.
DROP VIEW IF EXISTS public.v_ig_dm_delivery_truth;
CREATE VIEW public.v_ig_dm_delivery_truth AS
WITH m AS (SELECT *, (direction='outbound' AND raw_payload->>'error' IS NULL AND raw_payload->>'queued' IS NULL) AS delivered FROM public.inbox_messages WHERE source='instagram' AND received_at >= now() - interval '30 days')
SELECT d.day,
  (SELECT count(*) FROM m WHERE direction='inbound' AND received_at::date = d.day) AS inbound_msgs,
  (SELECT count(DISTINCT sender_handle) FROM m WHERE direction='inbound' AND received_at::date = d.day) AS inbound_people,
  (SELECT count(*) FROM m WHERE delivered AND received_at::date = d.day) AS delivered_msgs,
  (SELECT count(*) FROM m WHERE delivered AND auto_replied AND received_at::date = d.day) AS delivered_by_bot,
  (SELECT count(*) FROM m WHERE delivered AND NOT auto_replied AND received_at::date = d.day) AS delivered_by_sam,
  (SELECT count(*) FROM m WHERE direction='outbound' AND received_at::date = d.day AND raw_payload->>'error' IS NOT NULL) AS failed_rows,
  (SELECT count(DISTINCT i.sender_handle) FROM m i WHERE i.direction='inbound' AND i.received_at::date = d.day
     AND NOT EXISTS (SELECT 1 FROM m o WHERE o.delivered AND o.sender_handle=i.sender_handle AND o.received_at BETWEEN i.received_at AND i.received_at + interval '24 hours')) AS people_without_delivered_reply_24h
FROM (SELECT generate_series((now()-interval '29 days')::date, now()::date, '1 day')::date AS day) d
ORDER BY d.day DESC;
REVOKE ALL ON public.v_ig_dm_delivery_truth FROM anon, authenticated;
GRANT SELECT ON public.v_ig_dm_delivery_truth TO service_role;
