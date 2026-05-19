-- 2026-05-19 22:28 UTC — Stripe event observability + refund + sub + dispute tracking
-- Plugs the dark window opened when webhook routing fix landed (we_1TYtwoC3Khd8IPVm8uuptsRa).
-- Pairs with stripe-webhook-lead-purchase/index.ts rewrite that lands 12 event types.

-- 1) Idempotent audit log for every Stripe event we receive.
CREATE TABLE IF NOT EXISTS public.stripe_events_log (
  event_id        text        PRIMARY KEY,
  event_type      text        NOT NULL,
  api_version     text,
  livemode        boolean,
  event_created   timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  handled         boolean     NOT NULL DEFAULT false,
  handler_note    text,
  handler_error   text,
  payload         jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS stripe_events_log_type_idx ON public.stripe_events_log (event_type, event_created DESC);
CREATE INDEX IF NOT EXISTS stripe_events_log_unhandled_idx ON public.stripe_events_log (received_at DESC) WHERE handled = false;
ALTER TABLE public.stripe_events_log ENABLE ROW LEVEL SECURITY;

-- 2) Subscription lifecycle events (created / updated / deleted / past_due / trial / etc.)
CREATE TABLE IF NOT EXISTS public.stripe_subscription_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id text        NOT NULL,
  customer_id     text,
  customer_email  text,
  product_id      text,
  price_id        text,
  status          text,
  previous_status text,
  current_period_end timestamptz,
  cancel_at       timestamptz,
  canceled_at     timestamptz,
  amount_cents    integer,
  event_type      text        NOT NULL,
  event_id        text        REFERENCES public.stripe_events_log(event_id),
  event_created   timestamptz NOT NULL,
  raw             jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sse_sub_idx ON public.stripe_subscription_events (subscription_id, event_created DESC);
CREATE INDEX IF NOT EXISTS sse_customer_idx ON public.stripe_subscription_events (customer_id, event_created DESC);
ALTER TABLE public.stripe_subscription_events ENABLE ROW LEVEL SECURITY;

-- 3) Dispute / chargeback tracking (a single dispute = critical revenue risk)
CREATE TABLE IF NOT EXISTS public.stripe_disputes (
  dispute_id      text        PRIMARY KEY,
  charge_id       text        NOT NULL,
  payment_intent  text,
  customer_id     text,
  customer_email  text,
  amount_cents    integer     NOT NULL,
  currency        text        NOT NULL,
  reason          text,
  status          text        NOT NULL,
  evidence_due_by timestamptz,
  is_charge_refundable boolean,
  livemode        boolean,
  raw             jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sd_status_idx ON public.stripe_disputes (status, created_at DESC);
ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;

-- 4) Failed payment retries (Isaac Assaba's 8 failed charges pattern)
CREATE TABLE IF NOT EXISTS public.stripe_failed_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      text,
  payment_intent  text,
  customer_id     text,
  customer_email  text,
  subscription_id text,
  amount_due_cents integer,
  attempt_count   integer,
  next_payment_attempt timestamptz,
  failure_code    text,
  failure_message text,
  event_id        text,
  event_created   timestamptz NOT NULL,
  raw             jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sfp_customer_idx ON public.stripe_failed_payments (customer_id, event_created DESC);
CREATE INDEX IF NOT EXISTS sfp_sub_idx ON public.stripe_failed_payments (subscription_id, event_created DESC);
ALTER TABLE public.stripe_failed_payments ENABLE ROW LEVEL SECURITY;

-- 5) Augment lead_purchases with refund + dispute denorm columns
ALTER TABLE public.lead_purchases
  ADD COLUMN IF NOT EXISTS refunded_at         timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount_cents integer,
  ADD COLUMN IF NOT EXISTS refund_reason       text,
  ADD COLUMN IF NOT EXISTS disputed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_status      text,
  ADD COLUMN IF NOT EXISTS dispute_reason      text;

-- 6) Augment mentorship_leads if missing the product_id linkage (we need to know which tier paid)
ALTER TABLE public.mentorship_leads
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id   text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text;

-- 7) Health views

-- 7a) v_stripe_event_health — daily volume + handled rate
CREATE OR REPLACE VIEW public.v_stripe_event_health AS
SELECT
  date_trunc('day', received_at)::date           AS day,
  event_type,
  count(*)                                       AS events,
  count(*) FILTER (WHERE handled)                AS handled_ct,
  count(*) FILTER (WHERE NOT handled)            AS unhandled_ct,
  count(*) FILTER (WHERE handler_error IS NOT NULL) AS errored_ct,
  round(100.0 * count(*) FILTER (WHERE handled) / NULLIF(count(*), 0), 1) AS handled_pct
FROM public.stripe_events_log
WHERE received_at >= now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 4 DESC;

-- 7b) v_stripe_subscription_status — current state per sub (latest event wins)
CREATE OR REPLACE VIEW public.v_stripe_subscription_status AS
WITH latest AS (
  SELECT DISTINCT ON (subscription_id)
    subscription_id, customer_id, customer_email, product_id, price_id,
    status, current_period_end, cancel_at, canceled_at, amount_cents,
    event_created
  FROM public.stripe_subscription_events
  ORDER BY subscription_id, event_created DESC
)
SELECT * FROM latest;

-- 7c) v_stripe_dunning_watch — subs with failed payments in last 30d
CREATE OR REPLACE VIEW public.v_stripe_dunning_watch AS
SELECT
  fp.subscription_id,
  fp.customer_email,
  fp.customer_id,
  count(*)                                    AS failed_attempts,
  max(fp.amount_due_cents)                    AS amount_due_cents,
  max(fp.next_payment_attempt)                AS next_attempt,
  max(fp.event_created)                       AS last_failure_at,
  EXTRACT(epoch FROM (now() - min(fp.event_created)))::bigint / 86400 AS days_dunning
FROM public.stripe_failed_payments fp
WHERE fp.event_created >= now() - interval '30 days'
GROUP BY 1, 2, 3
HAVING count(*) >= 2
ORDER BY 4 DESC, 7 DESC;

-- 7d) v_stripe_refund_watch — refunds in last 30d (chargeback prevention signal)
CREATE OR REPLACE VIEW public.v_stripe_refund_watch AS
SELECT
  lp.stripe_charge_id,
  lp.customer_email,
  lp.customer_name,
  lp.amount_cents,
  lp.refund_amount_cents,
  lp.refund_reason,
  lp.refunded_at,
  lp.charged_at,
  EXTRACT(epoch FROM (lp.refunded_at - lp.charged_at))::bigint / 86400 AS days_to_refund
FROM public.lead_purchases lp
WHERE lp.refunded_at IS NOT NULL
  AND lp.refunded_at >= now() - interval '30 days'
ORDER BY lp.refunded_at DESC;

-- 8) Rebuild v_mentorship_pipeline to include paid + status breakdown
DROP VIEW IF EXISTS public.v_mentorship_pipeline CASCADE;
CREATE VIEW public.v_mentorship_pipeline AS
SELECT
  status,
  count(*)                          AS lead_count,
  sum(value_cents)::bigint           AS pipeline_cents,
  sum(CASE WHEN status = 'paid' THEN value_cents ELSE 0 END)::bigint AS collected_cents,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days')  AS new_7d,
  count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS new_30d
FROM public.mentorship_leads
GROUP BY status
ORDER BY pipeline_cents DESC NULLS LAST;

COMMENT ON TABLE public.stripe_events_log IS '2026-05-19: every Stripe webhook event is logged here for replay/audit. Idempotent on event_id.';
COMMENT ON TABLE public.stripe_subscription_events IS '2026-05-19: full sub lifecycle. Use v_stripe_subscription_status for current state.';
COMMENT ON TABLE public.stripe_disputes IS '2026-05-19: chargebacks. Any row = CRITICAL — respond before evidence_due_by.';
COMMENT ON TABLE public.stripe_failed_payments IS '2026-05-19: failed retries. Use v_stripe_dunning_watch to see at-risk subs.';
