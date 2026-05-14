-- 2026-05-14 — Seminar meeting URL config in system_settings
--
-- Phase 5: replace the hardcoded /seminar link in registration success
-- pages and reminder emails with a real meeting URL Sam can update without
-- a redeploy (Zoom / Meet / etc.).
--
-- Default placeholder points at the public /seminar route so we never
-- send recipients to a dead URL. Sam should swap this to the real Zoom
-- room before the next live seminar.
--
-- Idempotent.

INSERT INTO public.system_settings (key, value) VALUES
  ('seminar_meeting_url',       'https://apex-financial.org/seminar/join'),
  ('seminar_meeting_url_label', 'Join the seminar (Zoom)')
ON CONFLICT (key) DO NOTHING;
