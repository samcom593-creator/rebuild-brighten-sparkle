-- Add followup_sent_at columns for automated email tracking
ALTER TABLE public.applications 
ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS followup_licensed_sent_at TIMESTAMP WITH TIME ZONE;

-- Create function to keep lead_counter in sync with actual applications count
CREATE OR REPLACE FUNCTION public.sync_lead_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lead_counter 
  SET count = (SELECT COUNT(*) FROM public.applications WHERE terminated_at IS NULL);
  RETURN NULL;
END;
$$;

-- Create triggers for insert and delete on applications
DROP TRIGGER IF EXISTS sync_lead_counter_insert ON public.applications;
CREATE TRIGGER sync_lead_counter_insert
AFTER INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_counter();

DROP TRIGGER IF EXISTS sync_lead_counter_delete ON public.applications;
CREATE TRIGGER sync_lead_counter_delete
AFTER DELETE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_counter();

DROP TRIGGER IF EXISTS sync_lead_counter_update ON public.applications;
CREATE TRIGGER sync_lead_counter_update
AFTER UPDATE OF terminated_at ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_counter();

-- Sync the count now
UPDATE public.lead_counter 
SET count = (SELECT COUNT(*) FROM public.applications WHERE terminated_at IS NULL);