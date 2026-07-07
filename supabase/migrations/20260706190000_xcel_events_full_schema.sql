-- 20260706190000_xcel_events_full_schema.sql
-- XCEL DataExport ingestion schema: full column set + upsert index + progress view.

CREATE TABLE IF NOT EXISTS public.xcel_events (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id                 text,
  kind                            text,
  student_name                    text,
  student_email                   text,
  state_line                      text,
  event_at                        timestamptz,
  applied_to_crm                  boolean DEFAULT false,
  notified                        boolean DEFAULT false,
  created_at                      timestamptz NOT NULL DEFAULT now()
);

-- Legacy NOT NULL constraints from the original xcel_events table (Gmail-only ingest)
-- are incompatible with the DataExport source. Loosen them.
ALTER TABLE public.xcel_events ALTER COLUMN gmail_thread_id DROP NOT NULL;
ALTER TABLE public.xcel_events ALTER COLUMN kind            DROP NOT NULL;
ALTER TABLE public.xcel_events ALTER COLUMN event_at        DROP NOT NULL;

-- Additive columns for full XCEL DataExport ingestion
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS ingested_at                    timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS source                         text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS external_person_key            text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS email                          text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS first_name                     text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS middle_name                    text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS last_name                      text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS home_phone                     text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS address_1                      text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS address_2                      text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS city                           text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS state                          text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS zip_code                       text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS hiring_manager_name            text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS hiring_manager_email           text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS department                     text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS audiences                      text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS insurance_state_license_number text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS national_producer_number       text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS company                        text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS status                         text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS course_name                    text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS course_type                    text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS course_status                  text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS course_state                   text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS education_type                 text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS internal_code                  text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS sku                            text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS start_date                     date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS end_date                       date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS enrollment_date                date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS completion_date                date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS completion_datetime            timestamptz;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS overall_completion_date        date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS cert_expiration_date           date;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS pre_licensing_pct              integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS prep_review_pct                integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS simulated_exam_pct             integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS overall_pct                    integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS final_exam_attempts            integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS final_exam_score               integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS min_course_work                integer;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS time_remaining                 text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS time_in                        text;
ALTER TABLE public.xcel_events ADD COLUMN IF NOT EXISTS raw_row                        jsonb;

-- Upsert key
CREATE UNIQUE INDEX IF NOT EXISTS xcel_events_email_sku_uidx
  ON public.xcel_events (email, sku)
  WHERE email IS NOT NULL AND sku IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.xcel_events TO authenticated;

-- Aggregated per-person progress view
CREATE OR REPLACE VIEW public.v_xcel_person_progress AS
SELECT lower(email) AS email,
       MAX(overall_pct)                     AS overall_pct_max,
       MAX(final_exam_score)                AS final_exam_score_max,
       MAX(completion_date)                 AS most_recent_completion,
       MAX(national_producer_number)        AS national_producer_number,
       MAX(insurance_state_license_number)  AS state_license_number,
       COUNT(*)                             AS course_row_count
  FROM public.xcel_events
 WHERE email IS NOT NULL
 GROUP BY lower(email);

GRANT SELECT ON public.v_xcel_person_progress TO authenticated;
