-- ============================================================================
-- TELEGRAM PRE-AGENT HQ — 5 channels + 20 FAQ seed
-- 2026-05-22 — Sam James
--
-- Hard line: Discord owns ACTIVE agents (post-hire). Telegram is PRE-HIRE only.
-- This migration does NOT touch agents, Discord wiring, or any existing
-- telegram_* triggers/edge functions. It ONLY:
--   1) Extends telegram_groups.type CHECK constraint with 5 new types
--   2) UPSERTs 5 sentinel rows in telegram_groups (chat_id = -1..-5 placeholder
--      until the activation script binds the real Telegram chat_ids)
--   3) Seeds 20 brand-voice FAQs into telegram_faq (additive only — keeps
--      existing 12 [SEED] rows intact)
-- ============================================================================

-- 1) Extend the type CHECK so we can store the 5 Pre-Agent HQ channels alongside
--    the existing 8 types. Additive only.
ALTER TABLE public.telegram_groups DROP CONSTRAINT IF EXISTS telegram_groups_type_check;
ALTER TABLE public.telegram_groups ADD CONSTRAINT telegram_groups_type_check
  CHECK (type = ANY (ARRAY[
    -- existing types — DO NOT REMOVE
    'lobby','licensing','seminar','onboarding','training','wins','ai_dm','manager_alerts',
    -- NEW for Pre-Agent HQ
    'licensing_reference','daily_movement','seminar_reminders','ask_apex_ai'
  ]));

-- 2) UPSERT the 5 Pre-Agent HQ channel rows.
--    chat_id is NOT NULL UNIQUE bigint — use negative sentinels (-101..-105) so:
--      a) UNIQUE constraint is satisfied even though Telegram hasn't bound them yet
--      b) Real Telegram super-group chat_ids are -100xxxxxxx (more digits) so
--         there's zero collision risk
--      c) Activation script flips these to real chat_ids via title match
--    is_active starts FALSE so the bot won't try to post into a dead chat.
INSERT INTO public.telegram_groups (chat_id, title, type, is_active, rules)
VALUES
  (-101, 'APEX · START HERE',         'onboarding',          false,
    'First channel every new pre-hire is added to. Welcome message, ICA link, what happens next.'),
  (-102, 'APEX · LICENSING CENTER',   'licensing_reference', false,
    'State-by-state licensing instructions, fingerprinting steps, exam scheduling resources.'),
  (-103, 'APEX · DAILY MOVEMENT',     'daily_movement',      false,
    'Daily nudges + accountability check-ins. One message a day; reply with your move.'),
  (-104, 'APEX · SEMINAR REMINDERS',  'seminar_reminders',   false,
    'T-24h and T-1h reminders for the seminar Zoom. No chatter — reminders only.'),
  (-105, 'APEX · ASK APEX AI',        'ask_apex_ai',         false,
    'Ask anything. Bot answers from the 20-FAQ knowledge base. Falls back to manager DM if no FAQ matches with confidence >= 0.7.')
ON CONFLICT (chat_id) DO UPDATE
SET title = EXCLUDED.title,
    type = EXCLUDED.type,
    rules = EXCLUDED.rules,
    updated_at = now();

-- 3) Seed 20 brand-voice FAQs into telegram_faq.
--    Tag with category prefix 'preagent_hq' so we can find them again and so
--    the existing [SEED] rows (id 1..12) are not disturbed.
--    Idempotency: use a stable question_pattern prefix '[PRE-AGENT HQ]' so a
--    re-run finds and updates instead of duplicating.
--
--    Fallback rule (also enforced in the webhook fn): if no FAQ matches with
--    confidence >= 0.7, route the message to @theprincejames + Sam's manager
--    via the existing telegram_escalations trigger.

-- Helper: delete any prior [PRE-AGENT HQ] rows so we can cleanly re-insert.
-- Safe because (a) these are our rows only, (b) use_count is regenerated when
-- the FAQ is hit again.
DELETE FROM public.telegram_faq WHERE question_pattern LIKE '[PRE-AGENT HQ]%';

INSERT INTO public.telegram_faq (question_pattern, category, answer_body, match_keywords, use_count, active)
VALUES
  ('[PRE-AGENT HQ] Do I need a license before applying?', 'licensing',
'No. You apply first. Once your ICA is paid, your manager schedules your seminar. Licensing comes after that — and we tell you exactly what to do for your state.

You do not need to spend a dollar on pre-license before you talk to us.',
   ARRAY['need','license','before','apply','required','first'], 0, true),

  ('[PRE-AGENT HQ] How long until I can start selling?', 'licensing',
'Depends on your state. Typical window is 4 to 6 weeks from "I start studying" to "I write my first policy."

Faster if you grind the pre-license course. Slower if you let it sit. The exam is the choke point — book it early.',
   ARRAY['how','long','start','selling','timeline','when','can','sell'], 0, true),

  ('[PRE-AGENT HQ] What does Apex pay?', 'money',
'First-year agents at Apex typically clear $3K to $15K per month depending on volume, with top performers running $20K+. Comp tiers move up as you write more policies.

Specific numbers come from your manager on the call — they depend on carrier, product, and state.',
   ARRAY['pay','compensation','commission','salary','earn','make','money','income','comp'], 0, true),

  ('[PRE-AGENT HQ] Is this MLM?', 'general',
'No. Apex is a recruiting agency. You get paid for the policies you personally write, not for recruiting other people.

There is no downline. There is no recruiting requirement. You sell, you get paid.',
   ARRAY['mlm','pyramid','scheme','recruiting','downline','multi','level'], 0, true),

  ('[PRE-AGENT HQ] Can I do this part-time?', 'general',
'Yes, especially at the start. Most of our agents keep a day job through licensing and ramp up as they start closing.

The math: 2 closed policies a week part-time is a real income. 10 a week full-time is a top performer.',
   ARRAY['part','time','side','hustle','full','evening','weekend','keep','job'], 0, true),

  ('[PRE-AGENT HQ] What software / equipment do I need?', 'tech',
'A laptop or desktop and a phone with reliable service. That is it.

We give you the dialer (ReadyMode), the CRM (InsuraCloud), and the scripts. You do not buy software.',
   ARRAY['software','equipment','laptop','computer','phone','need','buy','setup'], 0, true),

  ('[PRE-AGENT HQ] What happens after my application?', 'application',
'Three steps. (1) Your ICA contract is sent to your inbox — sign + pay it. (2) Your manager DMs you to confirm a seminar slot (Wed / Fri / Sun on Zoom). (3) You attend the seminar, then we hand you the licensing roadmap for your state.

If you have not heard from a manager within 24 hours of paying the ICA, DM @theprincejames.',
   ARRAY['after','application','next','step','what','happens','then'], 0, true),

  ('[PRE-AGENT HQ] When are the seminars?', 'seminar',
'Wednesday, Friday, and Sunday — all on Zoom, all run by your manager. Exact times in your local zone are in the SEMINAR REMINDERS channel and the calendar invite you get after the ICA clears.

You get a T-24h reminder, a T-1h reminder, and the link.',
   ARRAY['when','seminar','time','day','schedule','zoom','meeting'], 0, true),

  ('[PRE-AGENT HQ] What if I miss the seminar?', 'seminar',
'No drama. The bot auto-offers you the next slot (Wed / Fri / Sun, whichever is next). You will get a DM within an hour of the seminar ending if you did not check in.

Missing two in a row puts your application on pause until you confirm a slot.',
   ARRAY['miss','missed','skip','seminar','next','reschedule'], 0, true),

  ('[PRE-AGENT HQ] Can I bring a friend to the seminar?', 'seminar',
'Yes — actually encouraged. If your friend is serious about insurance sales, send them the apex-financial.org/apply link first so they have their own application running.

Group hires are common at Apex. Iron sharpens iron.',
   ARRAY['friend','bring','invite','guest','plus','one','partner'], 0, true),

  ('[PRE-AGENT HQ] How does fingerprinting work?', 'licensing',
'Most states require a fingerprint background check through a vendor like IdentoGO or Fieldprint. You book online, walk in, pay ~$40 to $90, and your prints upload to your state insurance department directly.

State-specific instructions live in the LICENSING CENTER channel. Pin your state.',
   ARRAY['fingerprint','fingerprinting','background','check','identogo','fieldprint'], 0, true),

  ('[PRE-AGENT HQ] How do I schedule my licensing exam?', 'licensing',
'Once your pre-license course is done, you book the state exam through Pearson VUE or PSI (depends on the state). Walk-in test centers are everywhere.

Aim to book it within 7 days of finishing the course. Studying cold and waiting two months is how candidates fail.',
   ARRAY['schedule','exam','book','pearson','psi','test','state'], 0, true),

  ('[PRE-AGENT HQ] What state am I in — what do I do?', 'licensing',
'Every state is different. Pin your state in the LICENSING CENTER channel and the bot will surface your state-specific instructions (pre-license vendor, fingerprint vendor, exam vendor, fees).

If your state is not covered, DM @theprincejames and we will get you the right playbook.',
   ARRAY['my','state','what','do','where','i','live','licensing'], 0, true),

  ('[PRE-AGENT HQ] When do I get Discord access?', 'general',
'Discord is for active producing agents only — you unlock it after you are hired AND you have booked your first licensing exam. That keeps Discord focused on people actually doing the work.

Until then, Telegram is your home. Same team, different room.',
   ARRAY['discord','access','unlock','join','when','get'], 0, true),

  ('[PRE-AGENT HQ] When do I get training access?', 'general',
'Training opens the moment you book your first licensing exam. That is the line in the sand — booked exam means you are serious, and serious means you get the full library.

DM your exam confirmation to your manager and you are in.',
   ARRAY['training','access','library','when','unlock','course'], 0, true),

  ('[PRE-AGENT HQ] Do I get assigned a manager?', 'general',
'Yes. Your manager is locked in the moment your ICA is paid. They run your seminar, they run your first call, they sign off on your hire.

You can see your manager handle in the welcome message you got in START HERE. If you do not see one, reply "manager" in any channel and the bot escalates.',
   ARRAY['manager','assigned','mentor','coach','who','my'], 0, true),

  ('[PRE-AGENT HQ] How do I reach a human?', 'general',
'Reply "manager" or "help" in any channel. The bot escalates to your assigned manager AND Sam (@theprincejames) within minutes.

For non-urgent stuff, DM the bot directly — it answers from the FAQ and pings a human when it cannot.',
   ARRAY['human','manager','help','talk','someone','real','person','support'], 0, true),

  ('[PRE-AGENT HQ] What is the refund / cancel policy?', 'money',
'The ICA is non-refundable once your seminar slot is confirmed because that slot is held for you and unblocks the rest of the pipeline. Before the seminar confirmation, refund requests go to your manager.

Cancelling your spot is a DM away. We do not chase people who are not in.',
   ARRAY['refund','cancel','money','back','quit','withdraw','policy'], 0, true),

  ('[PRE-AGENT HQ] What is the difference between Telegram and Discord here?', 'general',
'Telegram = pre-hire. Application, ICA, seminar, licensing, the first 14 days of onboarding. This is where you live now.

Discord = post-hire. Active agents, leaderboards, live coaching, deal review. You move there once you are licensed AND hired.',
   ARRAY['telegram','discord','difference','vs','between','why','two'], 0, true),

  ('[PRE-AGENT HQ] Are you hiring in my state?', 'general',
'Apex writes business in most states. The fastest answer for your specific state is to apply at apex-financial.org/apply — the form checks your state in real time and tells you the same day.

If your state is restricted, the form tells you immediately and you do not waste a minute.',
   ARRAY['hiring','my','state','available','operate','where'], 0, true);

-- Notification / audit trail
DO $$
DECLARE
  v_groups int;
  v_faqs int;
BEGIN
  SELECT count(*) INTO v_groups FROM public.telegram_groups
    WHERE type IN ('onboarding','licensing_reference','daily_movement','seminar_reminders','ask_apex_ai')
      AND chat_id < 0;
  SELECT count(*) INTO v_faqs FROM public.telegram_faq
    WHERE question_pattern LIKE '[PRE-AGENT HQ]%';
  RAISE NOTICE 'TELEGRAM PRE-AGENT HQ READY: % sentinel channels + % FAQs seeded', v_groups, v_faqs;
END $$;
