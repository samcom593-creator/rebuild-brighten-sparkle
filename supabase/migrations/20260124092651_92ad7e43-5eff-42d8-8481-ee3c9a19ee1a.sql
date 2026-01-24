-- =====================================================
-- AGENT PERFORMANCE PORTAL: Database Schema
-- =====================================================

-- Add sort_order column to agents for drag-and-drop ordering
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Add portal_password_set flag to track first login
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS portal_password_set boolean DEFAULT false;

-- Create daily_production table for Live agent stats tracking
CREATE TABLE IF NOT EXISTS public.daily_production (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Core metrics
  presentations integer NOT NULL DEFAULT 0,
  passed_price integer NOT NULL DEFAULT 0,
  hours_called decimal(5,2) NOT NULL DEFAULT 0,
  referrals_caught integer NOT NULL DEFAULT 0,
  booked_inhome_referrals integer NOT NULL DEFAULT 0,
  referral_presentations integer NOT NULL DEFAULT 0,
  deals_closed integer NOT NULL DEFAULT 0,
  aop decimal(12,2) NOT NULL DEFAULT 0,
  
  -- Calculated fields (updated via trigger)
  closing_rate decimal(5,2) DEFAULT 0,
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Prevent duplicate entries per agent per day
  CONSTRAINT unique_agent_production_date UNIQUE (agent_id, production_date)
);

-- Enable RLS on daily_production
ALTER TABLE public.daily_production ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_production
CREATE POLICY "Agents can view their own production" 
ON public.daily_production 
FOR SELECT 
USING (
  agent_id = public.current_agent_id() OR
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  )
);

CREATE POLICY "Agents can insert their own production" 
ON public.daily_production 
FOR INSERT 
WITH CHECK (agent_id = public.current_agent_id());

CREATE POLICY "Agents can update their own production" 
ON public.daily_production 
FOR UPDATE 
USING (agent_id = public.current_agent_id());

-- Admins and managers can view all production
CREATE POLICY "Admins can manage all production" 
ON public.daily_production 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  )
);

-- Create function to auto-calculate closing_rate
CREATE OR REPLACE FUNCTION public.calculate_closing_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.presentations > 0 THEN
    NEW.closing_rate := ROUND((NEW.deals_closed::decimal / NEW.presentations::decimal) * 100, 2);
  ELSE
    NEW.closing_rate := 0;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for auto-calculating closing_rate
DROP TRIGGER IF EXISTS trigger_calculate_closing_rate ON public.daily_production;
CREATE TRIGGER trigger_calculate_closing_rate
BEFORE INSERT OR UPDATE ON public.daily_production
FOR EACH ROW
EXECUTE FUNCTION public.calculate_closing_rate();

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_daily_production_agent_date 
ON public.daily_production (agent_id, production_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_production_date 
ON public.daily_production (production_date DESC);

-- Enable realtime for daily_production for live leaderboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_production;