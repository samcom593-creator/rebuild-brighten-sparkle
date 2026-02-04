-- Add consent tracking columns to applications table for Twilio compliance
ALTER TABLE public.applications
ADD COLUMN IF NOT EXISTS sms_consent_given boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_consent_text text,
ADD COLUMN IF NOT EXISTS email_consent_given boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_consent_text text,
ADD COLUMN IF NOT EXISTS consent_timestamp_utc timestamp with time zone,
ADD COLUMN IF NOT EXISTS consent_source_url text,
ADD COLUMN IF NOT EXISTS consent_ip_address text,
ADD COLUMN IF NOT EXISTS consent_user_agent text,
ADD COLUMN IF NOT EXISTS consent_form_version text;