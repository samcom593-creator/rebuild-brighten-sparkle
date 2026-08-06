-- 2026-08-06 — supabase/functions/add-agent has been writing `agents.notes`
-- since the transfer block shipped, but the column never existed. The write
-- used a bare `await ...update(...)` with no error destructuring, so PostgREST
-- returned PGRST204 ("Could not find the 'notes' column of 'agents' in the
-- schema cache") into a value nobody read. Every [NEEDS TRANSFER] stamp
-- evaporated and the caller still got "Agent added successfully".
--
-- Same disease as the 465 fake-success InsuraCloud sync rows: a failed write
-- reported as a success. We keep the write (a row-level stamp is the right
-- shape for a roster filter — the structured detail already lands in
-- public.agent_notes and would otherwise need a join to see) and give it a
-- column to land in. The edge function is patched in the same commit to
-- surface the error instead of swallowing it.
--
-- Note: public.agents already has an orphan `leader_notes` text column
-- (0 of 178 rows populated, referenced by no view, function, or client file).
-- It is deliberately NOT reused: this stamp is system-generated transfer
-- state, not a leader's free-text note, and silently repurposing a column
-- would strand any future reader that trusts its name.

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.agents.notes IS
  'Row-level operational stamp so rosters/drawers can flag an agent without joining agent_notes (e.g. [NEEDS TRANSFER] owner=... next=...). Written by supabase/functions/add-agent. Full structured detail lives in public.agent_notes; this column is the filterable summary, never the system of record.';
