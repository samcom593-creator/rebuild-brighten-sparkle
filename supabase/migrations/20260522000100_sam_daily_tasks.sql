-- Sam HQ daily-task ledger
-- Sam's editable MUST/SHOULD/COULD checklist + cross-device sync surface for /admin/sam
-- Owner: Sam James (admin-only).

CREATE TABLE IF NOT EXISTS public.sam_daily_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL,
  bucket       text NOT NULL CHECK (bucket IN ('MUST','SHOULD','COULD')),
  task_text    text NOT NULL,
  block_time   text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  goal_tag     text,
  position     int DEFAULT 0,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sam_daily_tasks_date_idx   ON public.sam_daily_tasks(date);
CREATE INDEX IF NOT EXISTS sam_daily_tasks_status_idx ON public.sam_daily_tasks(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_sam_daily_tasks_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'done' AND OLD.status <> 'done' THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_sam_daily_tasks_touch ON public.sam_daily_tasks;
CREATE TRIGGER trg_sam_daily_tasks_touch
  BEFORE UPDATE ON public.sam_daily_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_sam_daily_tasks_touch();

-- RLS — admin-only via existing auth.role() pattern used elsewhere in this repo
ALTER TABLE public.sam_daily_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sam_daily_tasks_admin_all ON public.sam_daily_tasks;
CREATE POLICY sam_daily_tasks_admin_all ON public.sam_daily_tasks
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
-- NOTE: page itself is gated by ProtectedRoute requireAdmin in App.tsx. Server-side
-- RLS additionally requires an authenticated session so anon clients can't write.

-- Convenience view: tasks for "today" in CT
CREATE OR REPLACE VIEW public.v_sam_today_tasks AS
  SELECT id, bucket, task_text, block_time, status, goal_tag, position, completed_at
  FROM public.sam_daily_tasks
  WHERE date = (now() AT TIME ZONE 'America/Chicago')::date
  ORDER BY
    CASE bucket WHEN 'MUST' THEN 1 WHEN 'SHOULD' THEN 2 WHEN 'COULD' THEN 3 END,
    position,
    created_at;

-- Convenience view: 7-day window (today + next 6)
CREATE OR REPLACE VIEW public.v_sam_week_tasks AS
  SELECT
    date,
    count(*) FILTER (WHERE status='pending')  AS pending_count,
    count(*) FILTER (WHERE status='done')     AS done_count,
    count(*) FILTER (WHERE status='skipped')  AS skipped_count,
    count(*) AS total_count
  FROM public.sam_daily_tasks
  WHERE date BETWEEN (now() AT TIME ZONE 'America/Chicago')::date
                 AND (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '6 days'
  GROUP BY date
  ORDER BY date;
