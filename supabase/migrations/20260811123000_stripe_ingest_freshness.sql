-- wave-stripe-dark (2026-08-11)
--
-- Apex's Stripe ingest has been dark for 56.8 days: stripe_events_log holds 673
-- events spanning 2026-05-19 -> 2026-06-15 and then nothing, across ALL five
-- event classes at once (invoice.*, charge.*, payment_intent.*, customer.*,
-- checkout.session.*). Nothing on this machine noticed for eight weeks.
--
-- WHY NOTHING NOTICED. v_stripe_event_health -- the one view built to watch this
-- pipeline -- filters `received_at >= now() - interval '30 days'` and then GROUPs
-- BY day. Once the pipeline goes dark past 30 days the view returns ZERO ROWS,
-- and an empty result set on a health surface reads as "nothing wrong" to every
-- dashboard and every reader. It is structurally incapable of reporting the exact
-- failure it exists to catch: its silence is indistinguishable from its all-clear.
-- That is the 465-fake-success disease inverted -- not a lie written into a
-- column, an absence rendered as health.
--
-- THE FIX IS SHAPED AGAINST THAT. v_stripe_ingest_freshness is built entirely
-- from scalar subqueries with no time filter and no GROUP BY, so it returns
-- EXACTLY ONE ROW under every possible state of the underlying table, including
-- when that table is empty. A view that cannot go blank cannot go blank-green.
--
-- THRESHOLD IS MEASURED, NOT GUESSED. Over the 672 inter-event gaps observed
-- while the pipeline was actually alive: p50 0.00h, p90 0.32h, p99 35.05h,
-- max 40.55h (1.69 days). DARK_AFTER_DAYS = 3 therefore sits above observed-worst
-- with headroom and would have fired 0 times across that window. Stated honestly:
-- that window is only 27 days of a low-volume, bursty stream (p50 of 0.00h means
-- events arrive in clusters), so 3 days is "above everything we have ever seen",
-- not "provably cannot false-fire".
--
-- IT MUST NOT BECOME A PERMANENTLY RED GUARD. Rolling stripe_subscription_events
-- to the latest status per subscription_id gives 31 subscriptions with ZERO still
-- active (26 canceled worth $6,500/mo, 5 incomplete_expired). If the book is
-- genuinely empty then a perfectly healthy webhook produces zero events forever,
-- and a naive "no events for 3 days = CRITICAL" would scream permanently at a
-- working system. A guard everybody learns to skip is worth less than no guard.
-- So the verdict is THREE-valued and the middle state admits what it cannot know:
--
--   ok               -- an event landed inside the window
--   dark_book_active -- dark AND the last snapshot still held active subs.
--                       Money-bearing. This is the one that pages.
--   dark_book_empty  -- dark AND the last snapshot held no active subs. A dead
--                       endpoint and a wound-down book are INDISTINGUISHABLE from
--                       inside this database; the endpoint must be checked in
--                       Stripe directly. Reported as unresolved, never as ok.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. It does not assert money is being
-- lost. Stripe bills independently of this webhook, so revenue may be flowing
-- normally -- what is provably dead is Apex's KNOWLEDGE of it. The tempting
-- headlines were both operand errors of the kind this ledger keeps recording:
-- sum(amount_due_cents) over stripe_failed_payments is $90,250 but that sums
-- every RETRY of the same invoice (51 distinct invoices = $12,750), and even that
-- is mostly dunning Stripe abandoned months ago (attempt_count 9,
-- next_payment_attempt NULL). The defensible facts are narrower and are enough:
-- 97 of 97 stripe_failed_payment alerts and 40 of 40 subscription
-- cancelled/at-risk alerts were never delivered to anyone, in the event types'
-- entire lifetimes.

create or replace view public.v_stripe_ingest_freshness as
with book as (
  select count(*) filter (where status = 'active')   as active_subs,
         count(*) filter (where status = 'canceled') as canceled_subs,
         coalesce(sum(amount_cents) filter (where status = 'active'), 0) / 100.0 as active_monthly_value
  from (
    select distinct on (subscription_id) subscription_id, status, amount_cents
    from public.stripe_subscription_events
    order by subscription_id, event_created desc
  ) latest
)
select
  -- ingest liveness. No time filter anywhere: this row exists even for an empty table.
  (select count(*)        from public.stripe_events_log)                                     as events_lifetime,
  (select max(received_at) from public.stripe_events_log)                                    as last_event_at,
  round(extract(epoch from (now() - (select max(received_at) from public.stripe_events_log)))
        / 86400.0, 1)                                                                        as days_since_last_event,
  (select count(*) from public.stripe_events_log where received_at > now() - interval '24 hours') as events_24h,
  (select count(*) from public.stripe_events_log where received_at > now() - interval '7 days')   as events_7d,
  (select count(*) from public.stripe_events_log where received_at > now() - interval '30 days')  as events_30d,
  (select count(distinct event_type) from public.stripe_events_log)                          as event_classes_seen,
  3::int                                                                                     as dark_after_days,

  -- the book, as of the last thing the pipeline managed to tell us
  b.active_subs,
  b.canceled_subs,
  b.active_monthly_value,

  -- undelivered money signal. Counted per ALERT because that is what this measures
  -- -- how many times the system tried to speak and no one heard. It is NOT a
  -- dollar figure and must never be presented as one.
  (select count(*) from public.bot_alerts
    where event_type = 'stripe_failed_payment' and sent_at is null)                           as failed_payment_alerts_unsent,
  (select count(*) from public.bot_alerts
    where event_type in ('stripe_sub_cancelled','stripe_sub_at_risk') and sent_at is null)    as churn_alerts_unsent,

  case
    when (select count(*) from public.stripe_events_log) = 0                    then 'never_ingested'
    when (select max(received_at) from public.stripe_events_log)
         > now() - make_interval(days => 3)                                     then 'ok'
    when b.active_subs > 0                                                      then 'dark_book_active'
    else                                                                             'dark_book_empty'
  end                                                                                        as verdict
from book b;

comment on view public.v_stripe_ingest_freshness is
  'wave-stripe-dark 2026-08-11. Authority on whether Apex is still receiving Stripe '
  'events. Built from scalar subqueries with no time filter so it returns exactly one '
  'row in every state -- unlike v_stripe_event_health, whose 30-day window makes it '
  'render EMPTY (= indistinguishable from all-clear) precisely when the pipeline it '
  'watches is dead. dark_after_days=3 is measured against the 672 inter-event gaps '
  'observed while the pipeline was alive (p99 35.05h, max 40.55h). verdict '
  'dark_book_empty means a dead endpoint and a wound-down book cannot be told apart '
  'from inside this database -- check the endpoint in Stripe directly. This view does '
  'NOT assert money is being lost; Stripe bills independently of the webhook.';

-- Leave v_stripe_event_health in place (it is a legitimate per-day breakdown and
-- pg_depend confirms 0 dependent views) but label the trap on the object itself,
-- so the next reader who finds it empty knows that empty is not green.
comment on view public.v_stripe_event_health is
  'Per-day Stripe webhook breakdown, LAST 30 DAYS ONLY. TRAP: when ingest has been '
  'dark longer than 30 days this view returns ZERO ROWS, which reads as "healthy" on '
  'any surface that renders it. It went blank on ~2026-07-15 and stayed blank while '
  'the pipeline was dead for 56.8 days and nobody noticed. Do not use it to answer '
  '"is Stripe ingest alive" -- that is v_stripe_ingest_freshness, which cannot go '
  'blank. Use this one only to break down a stream already known to be flowing.';
