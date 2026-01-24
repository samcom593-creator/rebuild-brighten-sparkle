-- Add new columns to agents table for CRM enhancements
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS has_training_course boolean DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS has_dialer_login boolean DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS has_discord_access boolean DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS potential_rating integer DEFAULT 0;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS evaluation_result text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS evaluated_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS evaluated_by uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_deactivated boolean DEFAULT false;

-- Create enum for attendance status type
CREATE TYPE attendance_type AS ENUM ('training', 'onboarded_meeting');
CREATE TYPE attendance_mark AS ENUM ('present', 'absent', 'excused', 'unmarked');

-- Create agent_attendance table for daily tracking
CREATE TABLE public.agent_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  attendance_type attendance_type NOT NULL,
  status attendance_mark NOT NULL DEFAULT 'unmarked',
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, attendance_date, attendance_type)
);

-- Create agent_notes table
CREATE TABLE public.agent_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.agent_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_notes ENABLE ROW LEVEL SECURITY;

-- RLS policies for agent_attendance
CREATE POLICY "Admins can manage all attendance"
  ON public.agent_attendance FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage their team attendance"
  ON public.agent_attendance FOR ALL
  USING (has_role(auth.uid(), 'manager'::app_role) AND agent_id IN (
    SELECT id FROM public.agents WHERE invited_by_manager_id = current_agent_id()
  ));

CREATE POLICY "Agents can view own attendance"
  ON public.agent_attendance FOR SELECT
  USING (agent_id = current_agent_id());

-- RLS policies for agent_notes
CREATE POLICY "Admins can manage all notes"
  ON public.agent_notes FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage their team notes"
  ON public.agent_notes FOR ALL
  USING (has_role(auth.uid(), 'manager'::app_role) AND agent_id IN (
    SELECT id FROM public.agents WHERE invited_by_manager_id = current_agent_id()
  ));

CREATE POLICY "Agents can view own notes"
  ON public.agent_notes FOR SELECT
  USING (agent_id = current_agent_id());

-- Add updated_at trigger for agent_attendance
CREATE TRIGGER update_agent_attendance_updated_at
  BEFORE UPDATE ON public.agent_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_notes;