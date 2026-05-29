-- PL-098: Re-seed onboarding_modules with a real Apex curriculum.
-- Adds modules 4-14 (existing 0-3 preserved). video_url uses Sam's YouTube
-- channel home as a placeholder anchor until the real recorded modules drop;
-- swap each row's video_url when the production cut lands. pass_threshold
-- 80 for content modules, 100 for compliance, 90 for licensing.
insert into onboarding_modules (order_index, title, description, video_url, pass_threshold, is_active)
values
  (4, 'The Apex Story: How We Got Here', 'Founder Sam James walks through the Apex origin story — Nigerian boarding school to $120K/mo at 20. Why APEX exists, what we stand for, and the standard you''re joining.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (5, 'Carriers, Products, and What You''ll Actually Sell', 'Tour of the 22+ A-rated carriers Apex agents have appointments with. Final expense, term, IUL, mortgage protection — what fits which prospect.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (6, 'Lead Sources: How the Apex Lead System Works', 'Where leads come from (web, dialer, IG, referrals), how they''re routed, what each costs, and how to maximize ROI on every lead you touch.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (7, 'The Dialer: ReadyMode + Daily Activity Standard', 'How to log in, work a list, log activity, and hit the 100-dials-per-day floor. The activity formula that makes everything else work.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (8, 'CRM Mastery: AgentLink + Apex Pipeline', 'Track every applicant from first dial to first commission. AgentLink fields, pipeline stages, what notes to log, and how to never let a deal die in your inbox.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (9, 'The Appointment: First Call Framework', 'The structure of every first call — open, qualify, discover need, set the next step. Word-for-word framework + recorded examples.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (10, 'Closing: From Quoted to Submitted Application', 'How to take an interested prospect and write the app on the call. Quote presentation, payment discussion, e-app walkthrough, common drop-off points.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (11, 'Underwriting: From Submission to Issued', 'What happens after you submit. Underwriting timelines per carrier, requirements, how to fix kickbacks fast, when to escalate, and how to follow up with the client.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (12, 'Compliance, E&O, and the Lines You Don''t Cross', 'Replacement rules, suitability, doing right by the client. The compliance mistakes that cost agents their license. Mandatory pass at 100.', 'https://www.youtube.com/@SamuelJamesHQ', 100, true),
  (13, 'Commissions, Charge-backs, and Reading Your Statement', 'How you get paid, advance vs. as-earned, what causes charge-backs, and how to read your monthly carrier statement so you know what''s coming.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true),
  (14, 'Becoming a Top Producer: The 6-Figure Path', 'The exact daily/weekly habits of every Apex agent who hit six figures in year one. Calendar template, leaderboard mentality, and what to ignore.', 'https://www.youtube.com/@SamuelJamesHQ', 80, true);
