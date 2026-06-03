-- Telegram recruit resource command copy + FAQ seed.
-- Built 2026-06-03 after live drop-off audit.

INSERT INTO public.telegram_templates (key, description, body, parse_mode, buttons, version, active)
VALUES (
  'cmd.help',
  '/help reply',
  'Commands:
/start - re-link your file
/status - where you are right now
/resources - all recruit links
/contracting - paperwork checklist
/apply - application link
/license - pre-license help
/exam - schedule your exam
/seminar - next seminar info
/training - training hub (hired only)
/manager - escalate to human
/ask {q} - ask Apex AI
/pause /resume - nudge controls',
  'HTML',
  NULL,
  1,
  true
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    body = EXCLUDED.body,
    parse_mode = EXCLUDED.parse_mode,
    buttons = EXCLUDED.buttons,
    version = public.telegram_templates.version + 1,
    active = true,
    updated_at = now();

DELETE FROM public.telegram_faq WHERE question_pattern LIKE '[RECRUIT OPS]%';

INSERT INTO public.telegram_faq (question_pattern, category, answer_body, match_keywords, use_count, active)
VALUES
  ('[RECRUIT OPS] Where are all the recruit resources?', 'general',
'Use /resources. Start with apply, ICA/payment, licensing, exam, seminar, contracting, then /manager if a human needs to pick it up. Telegram is the pre-hire home until you are hired and moved into production systems.',
   ARRAY['resources','links','start','where','help','telegram'], 0, true),

  ('[RECRUIT OPS] What happens after ICA is paid?', 'application',
'ICA paid means the gate is open. Next: manager call/seminar slot, contracting prep, licensing path if needed, and onboarding reminders. If your ICA is paid and nobody has picked you up within 24 hours, use /manager.',
   ARRAY['ica','paid','payment','after','next','manager','seminar'], 0, true),

  ('[RECRUIT OPS] Contracting packet checklist', 'contract',
'Have these ready: license number/state, SSN for background, direct deposit or routing/account, driver''s license photo, and a monitored email/phone. Carrier emails matter; missing one can stall your writing number.',
   ARRAY['contracting','contract','packet','paperwork','documents','ready','carrier'], 0, true),

  ('[RECRUIT OPS] How long does contracting take?', 'contract',
'Background checks usually run 2-5 days. Carrier appointments often take 5-10 business days per carrier. First carrier approved means your writing number can be issued and you can start writing.',
   ARRAY['contracting','long','take','appointment','carrier','writing','number'], 0, true),

  ('[RECRUIT OPS] What if I am already licensed?', 'licensing',
'Already licensed means you skip the beginner licensing lane and move faster into manager review, contracting, and carrier appointments. Use /resources for the licensed-call link or /manager if you need routing.',
   ARRAY['already','licensed','license','skip','contracting','carrier'], 0, true),

  ('[RECRUIT OPS] Do I need the office to get started?', 'general',
'No. The office helps the team move faster, but your pre-hire path still runs through application, ICA, Telegram, manager call, contracting, and licensing/onboarding. If your manager assigns an in-office step, follow that directly.',
   ARRAY['office','in-person','started','start','remote','where'], 0, true);
