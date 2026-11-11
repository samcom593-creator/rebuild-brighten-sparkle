-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 2/9: seed licensing_state_requirements (decision N1) and let the
-- applicant's own status page read their state's row.
--
-- WHAT: N1 is decided (DECISIONS.md): the applicant buys the course at the Xcel partner price; we show
-- the state's exam, fingerprint and license fees from official sources with an as-of date; no
-- reimbursement promise; no income claims. The table WP2 created has been empty since 11-10, so every
-- cost surface showed nothing (shipped_vs_live WP2 row).
--
-- SOURCE: business-ops/2026-11-11-onboarding-anchor/staged/n1_licensing_costs.json (as_of 2026-11-11).
-- Only figures whose block confidence is "high" or "medium" are written. Everything else is NULL,
-- never a guess: Texas and Georgia fingerprint fees are not published (NULL, fingerprints still marked
-- required); processing fees are NULL where the source did not state one. The 11 seeded states hold
-- 471 of the 597 unlicensed applicants with a state in the last 12 months (WI 232, TX 72, FL 36,
-- AZ 27, CA 20, IL 18, GA 16, NY 15, MN 13, MS 11, PA 11).
--
-- OBJECTS:
--   licensing_state_requirements   + columns (state_name, as_of, course_*, exam_name, exam_schedule_url,
--                                    exam_phone, fingerprint_required, fingerprint_url,
--                                    license_processing_fee_usd, license_apply_via, license_apply_url,
--                                    watch_outs, sources). Existing columns keep their meaning;
--                                    exam_vendor_url = the scheduling page. 11 rows, is_active = true.
--   get_licensing_requirements_for_application(uuid)
--                                  SECURITY DEFINER, anon + authenticated. The public /status/:id page
--                                  knows only the application id; this returns the fee block for that
--                                  application's state and nothing else (no name, no contact field).
--                                  NULL when the application is licensed, its owner is suspended, the
--                                  state is unknown, or the state has no active row.
--
-- ROLLBACK: update public.licensing_state_requirements set is_active = false;  (or delete the 11 rows)
--   drop function public.get_licensing_requirements_for_application(uuid);
--   The added columns are nullable and harmless; drop them only after the UI no longer reads them.

alter table public.licensing_state_requirements
  add column if not exists state_name text,
  add column if not exists as_of date,
  add column if not exists course_provider text,
  add column if not exists course_name text,
  add column if not exists course_list_price_usd numeric(8, 2),
  add column if not exists course_extra_fee_usd numeric(8, 2),
  add column if not exists course_extra_fee_label text,
  add column if not exists course_url text,
  add column if not exists course_required boolean,
  add column if not exists exam_name text,
  add column if not exists exam_schedule_url text,
  add column if not exists exam_phone text,
  add column if not exists fingerprint_required boolean,
  add column if not exists fingerprint_url text,
  add column if not exists license_processing_fee_usd numeric(8, 2),
  add column if not exists license_apply_via text,
  add column if not exists license_apply_url text,
  add column if not exists watch_outs text[] not null default '{}'::text[],
  add column if not exists sources jsonb not null default '{}'::jsonb;

comment on table public.licensing_state_requirements is
  'Per-state licensing costs and vendors (WP2 table, seeded by PKG3 from official sources, as_of per row). course_price_usd = Xcel partner price via ?partner=afe. Rows render publicly only when is_active. NULL = not published by the source, never a guess.';
comment on column public.licensing_state_requirements.course_price_usd is 'Xcel partner price (the ?partner=afe link). course_list_price_usd is the public price without the partner link.';
comment on column public.licensing_state_requirements.exam_vendor_url is 'Exam scheduling page (same value as exam_schedule_url; kept for v_licensing_cost_public).';
comment on column public.licensing_state_requirements.fingerprint_fee_usd is 'NULL = the state requires fingerprints but no official source publishes the fee. 0 = not required for a life producer license.';
comment on column public.licensing_state_requirements.as_of is 'Date the figures were read from the sources in the sources column.';
comment on column public.licensing_state_requirements.sources is 'Per block: source_url, source_date, confidence (high|medium|none), checked.';

insert into public.licensing_state_requirements (
  state, state_name, as_of,
  course_provider, course_name, course_price_usd, course_list_price_usd,
  course_extra_fee_usd, course_extra_fee_label, course_url, course_required,
  exam_vendor, exam_name, exam_fee_usd, exam_schedule_url, exam_vendor_url, exam_phone,
  fingerprint_required, fingerprint_vendor, fingerprint_fee_usd, fingerprint_url,
  license_fee_usd, license_processing_fee_usd, license_apply_via, license_apply_url,
  watch_outs, notes, sources, is_active, updated_at)
select v.state, v.state_name, v.as_of::date,
       v.course_provider, v.course_name, v.course_price_usd::numeric, v.course_list_price_usd::numeric,
       v.course_extra_fee_usd::numeric, v.course_extra_fee_label, v.course_url, v.course_required::boolean,
       v.exam_vendor, v.exam_name, v.exam_fee_usd::numeric, v.exam_schedule_url, v.exam_vendor_url, v.exam_phone,
       v.fingerprint_required::boolean, v.fingerprint_vendor, v.fingerprint_fee_usd::numeric, v.fingerprint_url,
       v.license_fee_usd::numeric, v.license_processing_fee_usd::numeric, v.license_apply_via, v.license_apply_url,
       v.watch_outs, v.notes, v.sources, true, now()
  from (values
  ('WI', 'Wisconsin', '2026-11-11', 'XCEL Solutions', 'Wisconsin Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/wisconsin-life-pre-licensing-611wi020001a00?partner=afe', true, 'PSI', 'WI Life', 75, 'https://test-takers.psiexams.com/wiins', 'https://test-takers.psiexams.com/wiins', '888-818-5805', true, 'Fieldprint', 34.75, 'https://www.fieldprintwisconsin.com/', 10, 5.6, 'NIPR', 'https://nipr.com', array['Exam score, fingerprints: each valid about 6 months. Course certificate: 1 year.']::text[], 'Course: State requires 20 hours per line; online self-study needs a proctored course final. Exam: $75 for every producer exam. Score is valid six months. Fingerprints: Use Fieldprint code FPWIOCIINSURANCE. Valid 180 days. OCI takes no paper cards. License: $10 resident application fee for exam lines (Wis. Stat. 601.31(1)(Lg)). Apply 48-72 hours after passing.', '{"course":{"source_url":"https://partners.xcelsolutions.com/wisconsin-life-pre-licensing-611wi020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://oci.wi.gov/Pages/Agents/Prelicensing.aspx","required_confidence":"high"},"exam":{"source_url":"https://oci.wi.gov/Pages/Agents/ExamRequirements.aspx","source_date":"2026-06-01","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://oci.wi.gov/Pages/Agents/FingerPrinting.aspx","source_date":"2026-06-01","confidence":"high","checked":"2026-11-11"},"license":{"source_url":"https://nipr.com/licensing-center/state-requirements/wisconsin-resident-licensing-individual","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR transaction fee"}}'::jsonb),
  ('TX', 'Texas', '2026-11-11', 'XCEL Solutions', 'Texas Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/texas-life-pre-licensing-611tx020001a00?partner=afe', false, 'Pearson VUE', 'Life Agent (InsTX-Life01)', 39, 'https://www.pearsonvue.com/us/en/tx/insurance.html', 'https://www.pearsonvue.com/us/en/tx/insurance.html', '888-754-7667', true, 'IdentoGO', null, 'https://uenroll.identogo.com/', 50, null, 'Sircon or NIPR', 'https://www.tdi.texas.gov/agent/life-agent-apply.html', array['Start on TDI''s fingerprint portal first; it issues the IdentoGO service code.']::text[], 'Course: TDI''s life-agent steps are exam, fingerprints, application; no course is listed as required. Exam: General Lines Life, Accident & Health exam is $49. Apply within 12 months of passing. Fingerprints: Fee is not published on TDI''s pages or in the Pearson VUE handbook. TDI''s portal emails the service code after you start the application. License: $50 application fee.', '{"course":{"source_url":"https://partners.xcelsolutions.com/texas-life-pre-licensing-611tx020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://www.tdi.texas.gov/agent/life-agent-apply.html","required_confidence":"medium"},"exam":{"source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/124400.pdf","source_date":"2026-09-04","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://www.tdi.texas.gov/agent/fingerprint-instructions.html","source_date":"2024-08-05","confidence":"none","checked":"2026-11-11"},"license":{"source_url":"https://www.tdi.texas.gov/agent/life-agent-apply.html","source_date":"2026-04-17","confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR adds $5.60 if you apply there; Sircon''s fee was not checked"}}'::jsonb),
  ('FL', 'Florida', '2026-11-11', 'XCEL Solutions', 'Florida Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/florida-life-pre-licensing-611fl020001a00?partner=afe', true, 'Pearson VUE', '2-14 Life', 44, 'https://www.pearsonvue.com/fl/insurance', 'https://www.pearsonvue.com/fl/insurance', null, true, 'IdentoGO', 52.5, 'https://www.myfloridacfo.com/division/agents/licensing/agents-and-adjusters/fingerprinting-information', 55, null, 'Florida DFS MyProfile', 'https://www.myfloridacfo.com/division/agents/licensing/agents-and-adjusters/fees', array['Fingerprint price excludes county sales tax.']::text[], 'Course: 2-14 Life (incl. annuities and variable contracts) license; 30-hour course. Exam: DFS lists $44.00 ''as of October 1, 2018''. Fingerprints: Plus local county sales tax. License: $50 application + $5 license ID.', '{"course":{"source_url":"https://partners.xcelsolutions.com/florida-life-pre-licensing-611fl020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://myfloridacfo.com/docs-sf/insurance-agents-and-agency-services-libraries/agents-docs/licensure/agents-adjusters/2-14-resident-life-agent-license.pdf","required_confidence":"medium"},"exam":{"source_url":"https://www.myfloridacfo.com/division/agents/licensing/agents-and-adjusters/fees","source_date":null,"confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://www.myfloridacfo.com/division/agents/licensing/agents-and-adjusters/fingerprinting-information","source_date":null,"confidence":"high","checked":"2026-11-11"},"license":{"source_url":"https://www.myfloridacfo.com/division/agents/licensing/agents-and-adjusters/fees","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":null}}'::jsonb),
  ('AZ', 'Arizona', '2026-11-11', 'XCEL Solutions', 'Arizona Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/arizona-life-pre-licensing-611az020001a00?partner=afe', false, 'PSI', 'Life Insurance (13-31)', 50, 'https://test-takers.psiexams.com/anzins', 'https://test-takers.psiexams.com/anzins', '877-215-7924', true, 'Fieldprint + Arizona DPS', 30.69, 'https://difi.az.gov/finger-print', 120, 5.6, 'NIPR', 'https://nipr.com', array['Fingerprints come after the application, not before.']::text[], 'Course: Arizona law does not require pre-license education. The course is exam prep. Exam: Life + Accident and Health combined exam (13-33) is $59. Fingerprints: $8.25 to Fieldprint + $22.44 FBI fee paid to DPS. Do the Fieldprint visit only after the NIPR application is in. DIFI''s own page blocks automated readers; a search snippet of it says $22 for the FBI fee. License: $120 per license class, not refundable.', '{"course":{"source_url":"https://partners.xcelsolutions.com/arizona-life-pre-licensing-611az020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://nipr.com/licensing-center/state-requirements/arizona-resident-licensing-individual","required_confidence":"high"},"exam":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/12137","source_date":"2026-06-11","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/12137","source_date":"2026-06-11","confidence":"medium","checked":"2026-11-11"},"license":{"source_url":"https://nipr.com/licensing-center/state-requirements/arizona-resident-licensing-individual","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR transaction fee"}}'::jsonb),
  ('CA', 'California', '2026-11-11', 'XCEL Solutions', 'California Life Pre-licensing With Ethics', 49, 199, 6, 'California state reporting fee, added at Xcel checkout', 'https://partners.xcelsolutions.com/california-life-pre-licensing-with-ethics-611ca020001p00?partner=afe', true, 'PSI', 'Life-Only', 98, 'https://test-takers.psiexams.com/cadi', 'https://test-takers.psiexams.com/cadi', '833-518-7456', true, 'Capital Live Scan', 74, 'https://www.insurance.ca.gov/0200-industry/0200-prod-licensing/0100-applicant-info/0300-ca-fingerprint/index.cfm', 188, null, 'Sircon or NIPR', 'https://www.insurance.ca.gov/0200-industry/0020-apply-license/0100-indiv-resident/', array['Exam is $43 cheaper at the state''s Los Angeles site.']::text[], 'Course: 32 hours: 20 product + 12 code and ethics. Exam: $55 state exam fee + $43 PSI convenience fee at PSI sites or online. $55 only at the Department''s Los Angeles exam site. Fingerprints: FBI $17 + DOJ $32 + vendor $25. Submit the license application first. License: $188 filing fee, two-year term, not refundable.', '{"course":{"source_url":"https://partners.xcelsolutions.com/california-life-pre-licensing-with-ethics-611ca020001p00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://www.insurance.ca.gov/0200-industry/0090-faq/lo-ahfaq.cfm","required_confidence":"high"},"exam":{"source_url":"https://www.insurance.ca.gov/0200-industry/0010-producer-online-services/0200-exam-info/index.cfm","source_date":null,"confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://www.insurance.ca.gov/0200-industry/0200-prod-licensing/0100-applicant-info/0300-ca-fingerprint/index.cfm","source_date":null,"confidence":"high","checked":"2026-11-11"},"license":{"source_url":"https://www.insurance.ca.gov/0200-industry/0090-faq/lo-ahfaq.cfm","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR adds $5.60 if you apply there"}}'::jsonb),
  ('IL', 'Illinois', '2026-11-11', 'XCEL Solutions', 'Illinois Life Pre-licensing', 99, 249, 0, null, 'https://partners.xcelsolutions.com/illinois-life-pre-licensing-611il120001h00?partner=afe', true, 'Pearson VUE', 'Life: General + State', 92, 'https://www.pearsonvue.com/us/en/il/insurance.html', 'https://www.pearsonvue.com/us/en/il/insurance.html', '800-274-0402', false, null, 0, null, 215, 5.6, 'NIPR', 'https://nipr.com', array['Book both exams on one order or you pay $92 twice.']::text[], 'Course: Blended format (part live). Certificate valid one year. Exam: Two exams, $92 for the pair when booked on one order. Booked separately it is $92 each. Fingerprints: Not required for producers; NIPR lists fingerprints only for public adjusters. License: $215 for a two-year term, prorated to your birth month (18 to 29 months). Wait five days after the exam.', '{"course":{"source_url":"https://partners.xcelsolutions.com/illinois-life-pre-licensing-611il120001h00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/121400.pdf","required_confidence":"high"},"exam":{"source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/121400.pdf","source_date":"2026-10-19","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://nipr.com/licensing-center/state-requirements/illinois-resident-licensing-individual","source_date":null,"confidence":"medium","checked":"2026-11-11"},"license":{"source_url":"https://nipr.com/licensing-center/state-requirements/illinois-resident-licensing-individual","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR transaction fee"}}'::jsonb),
  ('GA', 'Georgia', '2026-11-11', 'XCEL Solutions', 'Georgia Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/georgia-life-pre-licensing-611ga020001a00?partner=afe', true, 'Pearson VUE', 'Life Agent (12-GA-01)', 67, 'https://www.pearsonvue.com/us/en/ga/insurance.html', 'https://www.pearsonvue.com/us/en/ga/insurance.html', '800-274-8969', true, 'IdentoGO (GAPS)', null, 'https://ga.state.identogo.com/ata', 120, null, 'Sircon', 'https://www.sircon.com/georgia', array['Needs a notarized Citizenship Affidavit; notary cost not included.']::text[], 'Course: State handbook (Oct 2026) asks for an 8-hour Life course taken in the last 12 months; Xcel lists its Georgia course at 20 hours. Fingerprints: Fee is shown only inside GAPS registration; OCI does not publish it. Service code 2TGJ6B. Register only after applying on Sircon. License: $100 license + $20 processing. A notarized Citizenship Affidavit is required.', '{"course":{"source_url":"https://partners.xcelsolutions.com/georgia-life-pre-licensing-611ga020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/121100.pdf","required_confidence":"high"},"exam":{"source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/121100.pdf","source_date":"2026-10-15","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://oci.georgia.gov/get-resident-insurance-agent-license","source_date":null,"confidence":"none","checked":"2026-11-11"},"license":{"source_url":"https://oci.georgia.gov/get-resident-insurance-agent-license","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"The $120 already includes the $20 processing fee"}}'::jsonb),
  ('NY', 'New York', '2026-11-11', 'XCEL Solutions', 'New York Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/new-york-life-pre-licensing-611ny020001a00?partner=afe', true, 'PSI', 'Life Agent (17-51)', 40, 'https://test-takers.psiexams.com/nyins', 'https://test-takers.psiexams.com/nyins', '855-579-4637', false, null, 0, null, 80, 5.6, 'NIPR', 'https://nipr.com', array['License fee can be $40 instead of $80 depending on your birth date.']::text[], 'Course: 20 hours for Life; 40 for Life/Accident & Health. Exam: Bulletin text is marked ''Updated 4/28/2023''. Fingerprints: Not required for agents; New York fingerprints adjusters, bail bond and life settlement brokers. License: $80 when the first term runs over a year, $40 when it is a year or less (set by your birthday).', '{"course":{"source_url":"https://partners.xcelsolutions.com/new-york-life-pre-licensing-611ny020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://test-takers.psiexams.com/api/content/bulletin/7186","required_confidence":"high"},"exam":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/7186","source_date":"2025-07-07","confidence":"medium","checked":"2026-11-11"},"fingerprint":{"source_url":"https://nipr.com/licensing-center/state-requirements/new-york-resident-licensing-individual","source_date":null,"confidence":"high","checked":"2026-11-11"},"license":{"source_url":"https://nipr.com/licensing-center/state-requirements/new-york-resident-licensing-individual","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR transaction fee"}}'::jsonb),
  ('MN', 'Minnesota', '2026-11-11', 'XCEL Solutions', 'Minnesota Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/minnesota-life-pre-licensing-611mn020001a00?partner=afe', true, 'PSI', 'Life Producer', 45, 'https://test-takers.psiexams.com/mnins', 'https://test-takers.psiexams.com/mnins', '866-395-1006', true, 'PSI test center', 66.75, 'https://mn.gov/commerce/licensing/list/insurance/resident-producers.jsp', 60, null, 'Sircon', 'https://www.sircon.com/minnesota', '{}'::text[], 'Course: 20 hours per line (MN Stat. 60K.36). Fingerprints: Taken at the test center right after you pass. License: $50 license (Minn. Stat. 60K.55) + $10 technology fee. NIPR''s wording on per-line charges is ambiguous.', '{"course":{"source_url":"https://partners.xcelsolutions.com/minnesota-life-pre-licensing-611mn020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://test-takers.psiexams.com/api/content/bulletin/10983","required_confidence":"high"},"exam":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/10983","source_date":"2026-10-29","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/10983","source_date":"2026-10-29","confidence":"high","checked":"2026-11-11"},"license":{"source_url":"https://www.revisor.mn.gov/statutes/cite/60K.55","source_date":null,"confidence":"medium","checked":"2026-11-11","processing_fee_note":"Sircon''s fee was not checked"}}'::jsonb),
  ('MS', 'Mississippi', '2026-11-11', 'XCEL Solutions', 'Mississippi Life Pre-licensing', 49, 199, 4.75, 'Mississippi state reporting fee, added at Xcel checkout', 'https://partners.xcelsolutions.com/mississippi-life-pre-licensing-611ms020001a00?partner=afe', false, 'Pearson VUE', 'Life Producer (InsMS-Life01)', 50, 'https://www.pearsonvue.com/us/en/ms/insurance.html', 'https://www.pearsonvue.com/us/en/ms/insurance.html', '888-293-4222', false, null, 0, null, 100, 1, 'Sircon or NIPR', 'https://www.sircon.com/mississippi', '{}'::text[], 'Course: Since July 1, 2024 (House Bill 819) Life applicants are exempt from the 20-hour course. Fingerprints: The Department lists fingerprinting for bail agents only. License: $100 Insurance Producer license.', '{"course":{"source_url":"https://partners.xcelsolutions.com/mississippi-life-pre-licensing-611ms020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":"https://www.mid.ms.gov/mississippi-insurance-department/licensing/producer-individual-licensing/","required_confidence":"high"},"exam":{"source_url":"https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/publications/122500.pdf","source_date":"2025-07-21","confidence":"medium","checked":"2026-11-11"},"fingerprint":{"source_url":"https://www.mid.ms.gov/mississippi-insurance-department/licensing/producer-individual-licensing/","source_date":null,"confidence":"medium","checked":"2026-11-11"},"license":{"source_url":"https://www.mid.ms.gov/mississippi-insurance-department/licensing/licensing-forms-and-fees/","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"$1 online application fee per session"}}'::jsonb),
  ('PA', 'Pennsylvania', '2026-11-11', 'XCEL Solutions', 'Pennsylvania Life Pre-licensing', 49, 199, 0, null, 'https://partners.xcelsolutions.com/pennsylvania-life-pre-licensing-611pa020001a00?partner=afe', null, 'PSI', 'Life Insurance (16-01)', 45, 'https://test-takers.psiexams.com/pain', 'https://test-takers.psiexams.com/pain', '888-818-5822', true, 'IdentoGO', 27.95, 'https://uenroll.identogo.com/workflows/1KGBGJ', 55, null, 'Sircon or NIPR', 'https://www.pa.gov/agencies/insurance/licensing/licensees/initial-insurance-producer-licensing-process', array['Do not get fingerprinted before you pass and apply.']::text[], 'Course: 24 hours per Xcel''s listing; the hour count was not confirmed on a state page. Exam: Life, Accident and Health combined (16-03) is $55. Fingerprints: Service code 1KGBGJ. Only after you pass and apply, or you pay twice. Amount read from IdentoGO''s own fee lookup for that code. License: $55 resident application fee.', '{"course":{"source_url":"https://partners.xcelsolutions.com/pennsylvania-life-pre-licensing-611pa020001a00?partner=afe","confidence":"high","checked":"2026-11-11","required_source_url":null,"required_confidence":"low"},"exam":{"source_url":"https://test-takers.psiexams.com/api/content/bulletin/7280","source_date":"2026-01-22","confidence":"high","checked":"2026-11-11"},"fingerprint":{"source_url":"https://uenroll.identogo.com/workflows/fees/1KGBGJ","source_date":null,"confidence":"medium","checked":"2026-11-11"},"license":{"source_url":"https://www.pa.gov/agencies/insurance/licensing/licensees/initial-insurance-producer-licensing-process","source_date":null,"confidence":"high","checked":"2026-11-11","processing_fee_note":"NIPR adds $5.60 if you apply there"}}'::jsonb)

  ) as v(state, state_name, as_of,
         course_provider, course_name, course_price_usd, course_list_price_usd,
         course_extra_fee_usd, course_extra_fee_label, course_url, course_required,
         exam_vendor, exam_name, exam_fee_usd, exam_schedule_url, exam_vendor_url, exam_phone,
         fingerprint_required, fingerprint_vendor, fingerprint_fee_usd, fingerprint_url,
         license_fee_usd, license_processing_fee_usd, license_apply_via, license_apply_url,
         watch_outs, notes, sources)
on conflict (state) do update set
  state_name = excluded.state_name, as_of = excluded.as_of,
  course_provider = excluded.course_provider, course_name = excluded.course_name,
  course_price_usd = excluded.course_price_usd, course_list_price_usd = excluded.course_list_price_usd,
  course_extra_fee_usd = excluded.course_extra_fee_usd, course_extra_fee_label = excluded.course_extra_fee_label,
  course_url = excluded.course_url, course_required = excluded.course_required,
  exam_vendor = excluded.exam_vendor, exam_name = excluded.exam_name, exam_fee_usd = excluded.exam_fee_usd,
  exam_schedule_url = excluded.exam_schedule_url, exam_vendor_url = excluded.exam_vendor_url, exam_phone = excluded.exam_phone,
  fingerprint_required = excluded.fingerprint_required, fingerprint_vendor = excluded.fingerprint_vendor,
  fingerprint_fee_usd = excluded.fingerprint_fee_usd, fingerprint_url = excluded.fingerprint_url,
  license_fee_usd = excluded.license_fee_usd, license_processing_fee_usd = excluded.license_processing_fee_usd,
  license_apply_via = excluded.license_apply_via, license_apply_url = excluded.license_apply_url,
  watch_outs = excluded.watch_outs, notes = excluded.notes, sources = excluded.sources,
  is_active = true, updated_at = now();


-- ---------------------------------------------------------------------------
-- The applicant's own page reads its state's row through this. No PII out: the state code is the
-- only thing derived from the application, and the caller already holds the application id.
-- ---------------------------------------------------------------------------
create or replace function public.get_licensing_requirements_for_application(p_application_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with a as (
    select ap.id, public.us_state_code(ap.state) as st, ap.email
      from public.applications ap
     where ap.id = p_application_id
       and coalesce(ap.license_status::text, 'unlicensed') <> 'licensed'
       and ap.licensed_at is null
       and coalesce(ap.is_duplicate, false) = false
  ), r as (
    select q.*,
           -- known fees only; a required-but-unpublished fee is listed in "missing", never guessed
           coalesce(q.course_price_usd, 0) + coalesce(q.course_extra_fee_usd, 0)
             + coalesce(q.exam_fee_usd, 0)
             + case when q.fingerprint_required is false then 0 else coalesce(q.fingerprint_fee_usd, 0) end
             + coalesce(q.license_fee_usd, 0) + coalesce(q.license_processing_fee_usd, 0) as total_known
      from public.licensing_state_requirements q
      join a on a.st = q.state
     where q.is_active
  )
  select jsonb_build_object(
           'state', r.state,
           'state_name', r.state_name,
           'as_of', r.as_of,
           'course', jsonb_build_object(
              'provider', r.course_provider, 'price_usd', r.course_price_usd,
              'list_price_usd', r.course_list_price_usd, 'extra_fee_usd', r.course_extra_fee_usd,
              'extra_fee_label', r.course_extra_fee_label, 'url', r.course_url,
              'required_by_state', r.course_required),
           'exam', jsonb_build_object(
              'vendor', r.exam_vendor, 'fee_usd', r.exam_fee_usd,
              'schedule_url', coalesce(r.exam_schedule_url, r.exam_vendor_url)),
           'fingerprint', jsonb_build_object(
              'required', r.fingerprint_required, 'vendor', r.fingerprint_vendor,
              'fee_usd', r.fingerprint_fee_usd, 'url', r.fingerprint_url),
           'license', jsonb_build_object(
              'fee_usd', r.license_fee_usd, 'processing_fee_usd', r.license_processing_fee_usd,
              'apply_via', r.license_apply_via),
           'total_known_usd', round(r.total_known, 2),
           'missing', to_jsonb(array_remove(array[
              case when r.course_price_usd is null then 'course' end,
              case when r.exam_fee_usd is null then 'exam' end,
              case when coalesce(r.fingerprint_required, true) and r.fingerprint_fee_usd is null then 'fingerprint' end,
              case when r.license_fee_usd is null then 'license' end], null)))
    from r
   where not exists (
     -- nobody with an open suspension gets anything built here (same rule as every PKG3 sender)
     select 1
       from public.agent_access_suspensions s
       join auth.users u on u.id = s.user_id
       join a on lower(btrim(u.email)) = lower(btrim(a.email))
      where s.lifted_at is null)
$$;

comment on function public.get_licensing_requirements_for_application(uuid) is
  'PKG3: the fee block for one application''s state (course partner price, exam vendor/fee/scheduling link, fingerprints, license fee, known total, as_of). Anon-callable for /status/:id like get_application_status; returns only public licensing_state_requirements data. NULL for licensed, suspended, unknown-state or unseeded-state applications.';

revoke all on function public.get_licensing_requirements_for_application(uuid) from public;
grant execute on function public.get_licensing_requirements_for_application(uuid) to anon, authenticated, service_role;
