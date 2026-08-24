-- Announce deals that arrive from AgentLink — including every Vantage deal.
--
-- Sam: "make sure you're counting AND announcing every deal from Vantage Discord."
--
-- COUNTING was already right: 242 Vantage deals / $328,806 flow through the
-- book sync and appear in production. ANNOUNCING never happened at all.
-- trg_deal_celebration fires on public.deals; AgentLink deals land in
-- public.agentlink_book, which had ZERO triggers. So every deal written by
-- KJ's team — and every AgentLink deal generally — was silent. Separately,
-- discord_webhook_url_subagency_deals has been configured all along and NO
-- function in the database has ever referenced it: the Vantage channel exists
-- and nothing has ever posted to it.
--
-- THE DANGER HERE IS A STORM, NOT A MISS. agentlink-cookie-sync re-imports the
-- whole book on every run (1,731 rows) and upserts on deal_key. A naive AFTER
-- INSERT trigger would announce hundreds of historical deals the first time it
-- ran, and the channel would be muted within a day — the same failure as the
-- 36-false-pages-a-day wave. Three independent guards:
--   1. a ledger of what has already been announced, keyed on deal_key
--   2. a freshness window — only deals posted within 3 days can speak at all,
--      so a historical backfill is structurally silent
--   3. a per-statement cap — if one statement brings in more than 25 eligible
--      rows that is a bulk import, not a sales day, so it records them as seen
--      WITHOUT posting
create table if not exists public.agentlink_book_announced (
  deal_key text primary key,
  announced_at timestamptz not null default now(),
  channel text,
  posted boolean not null default true
);
alter table public.agentlink_book_announced enable row level security;

create or replace function public.trg_fn_agentlink_book_announce()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_webhook text;
  v_channel text;
  v_agency text;
  v_is_vantage boolean := false;
  v_recent int;
  v_body jsonb;
  v_name text;
BEGIN
  IF NEW.deal_key IS NULL OR NEW.annual_premium IS NULL THEN RETURN NEW; END IF;
  IF NEW.is_dead IS TRUE THEN RETURN NEW; END IF;
  IF public.fn_agent_is_roster_excluded(NEW.agent_id) THEN RETURN NEW; END IF;

  -- guard 2: only genuinely recent business speaks
  IF NEW.posted_date IS NULL OR NEW.posted_date < v_today - 3 THEN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'skipped_stale', false) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- guard 1: never announce the same deal twice, however often the sync reruns
  IF EXISTS (SELECT 1 FROM public.agentlink_book_announced a WHERE a.deal_key = NEW.deal_key) THEN
    RETURN NEW;
  END IF;

  -- guard 3: a burst is an import, not a sales day
  SELECT count(*) INTO v_recent
  FROM public.agentlink_book_announced
  WHERE announced_at > now() - interval '2 minutes' AND posted;
  IF v_recent >= 25 THEN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'skipped_burst', false) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Vantage (KJ's leg) announces in its own channel; everyone else in the main
  -- one. Never falls back between channels — a deal posted to the wrong team's
  -- room is worse than one that waits for a fix.
  SELECT (a.agent_code = 'KJV01' OR mgr.agent_code = 'KJV01')
    INTO v_is_vantage
  FROM public.agents a
  LEFT JOIN public.agents mgr ON mgr.id = a.manager_id
  WHERE a.id = NEW.agent_id;
  v_is_vantage := coalesce(v_is_vantage, false);

  IF v_is_vantage THEN
    v_channel := 'subagency_deals'; v_agency := 'Vantage Financial';
    SELECT value INTO v_webhook FROM public.system_settings WHERE key = 'discord_webhook_url_subagency_deals';
  ELSE
    v_channel := 'main'; v_agency := 'APEX Financial';
    SELECT value INTO v_webhook FROM public.system_settings WHERE key = 'discord_webhook_url';
  END IF;
  IF v_webhook IS NULL OR v_webhook NOT LIKE 'https://discord.com/api/webhooks/%' THEN RETURN NEW; END IF;

  v_name := coalesce(nullif(btrim(NEW.agent_name), ''), 'Agent');

  -- Producer in the title, never the client. Publishing a life-insurance
  -- customer's name into a chat channel is the a71e321c defect; it stays fixed.
  v_body := jsonb_build_object('embeds', jsonb_build_array(jsonb_build_object(
    'title', format('✅ DEAL POSTED — %s', v_name),
    'color', 13210919,
    'fields', jsonb_build_array(
      jsonb_build_object('name','Annual premium','value','$' || to_char(NEW.annual_premium,'FM999,999,990.00'),'inline',true),
      jsonb_build_object('name','Carrier','value',coalesce(NEW.carrier,'N/A'),'inline',true),
      jsonb_build_object('name','Agency','value',v_agency,'inline',true)),
    'footer', jsonb_build_object('text','APEX Financial · via AgentLink'),
    'timestamp', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

  PERFORM net.http_post(url := v_webhook, body := v_body,
                        headers := jsonb_build_object('Content-Type','application/json'));

  INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
  VALUES (NEW.deal_key, v_channel, true) ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- An announcement must never be able to break the sync that feeds production.
  BEGIN
    INSERT INTO public.agentlink_book_announced (deal_key, channel, posted)
    VALUES (NEW.deal_key, 'error:' || left(SQLERRM, 80), false) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

drop trigger if exists trg_agentlink_book_announce on public.agentlink_book;
create trigger trg_agentlink_book_announce
  after insert on public.agentlink_book
  for each row execute function public.trg_fn_agentlink_book_announce();

-- BACKFILL THE LEDGER as already-seen. Without this the very next sync would
-- treat every existing recent deal as new and fire a burst. Marked posted=false
-- because they were never actually announced — the ledger must not claim credit
-- for messages that were never sent.
insert into public.agentlink_book_announced (deal_key, channel, posted)
select deal_key, 'backfill_pre_existing', false from public.agentlink_book
on conflict do nothing;
