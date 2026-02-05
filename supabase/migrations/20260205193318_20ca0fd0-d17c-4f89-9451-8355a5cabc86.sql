-- Add lead_source column to aged_leads table for categorization
ALTER TABLE public.aged_leads 
ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'aged' CHECK (lead_source IN ('aged', 'new_drip'));

-- Add index for filtering by lead source
CREATE INDEX IF NOT EXISTS idx_aged_leads_lead_source ON public.aged_leads(lead_source);