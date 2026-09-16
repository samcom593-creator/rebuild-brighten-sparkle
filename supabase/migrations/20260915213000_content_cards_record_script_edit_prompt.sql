-- Launch Board video kit (2026-09-15): every card carries two copy-paste blocks —
-- what to record (shot list + the lines to say on camera) and the edit prompt that
-- turns the footage into the finished cut under MP-232. Hand-applied via bot-sql the
-- same day and recorded in schema_migrations; idempotent so a replay is a no-op.
ALTER TABLE public.content_cards ADD COLUMN IF NOT EXISTS record_script text NOT NULL DEFAULT '';
ALTER TABLE public.content_cards ADD COLUMN IF NOT EXISTS edit_prompt text NOT NULL DEFAULT '';
