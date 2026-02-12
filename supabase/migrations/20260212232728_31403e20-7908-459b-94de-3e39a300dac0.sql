
-- Create banned_prospects table
CREATE TABLE public.banned_prospects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text,
  phone text,
  first_name text,
  last_name text,
  reason text,
  banned_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint on email when not null
CREATE UNIQUE INDEX banned_prospects_email_unique ON public.banned_prospects (lower(email)) WHERE email IS NOT NULL;

-- Enable RLS
ALTER TABLE public.banned_prospects ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can manage banned prospects"
ON public.banned_prospects
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Managers can view and insert banned prospects
CREATE POLICY "Managers can view banned prospects"
ON public.banned_prospects
FOR SELECT
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can insert banned prospects"
ON public.banned_prospects
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- Create check function
CREATE OR REPLACE FUNCTION public.check_banned_prospect(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.banned_prospects
    WHERE
      (p_email IS NOT NULL AND lower(trim(email)) = lower(trim(p_email)))
      OR (p_phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') != '' 
          AND right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(phone, '[^0-9]', '', 'g'), 10))
      OR (p_first_name IS NOT NULL AND p_last_name IS NOT NULL 
          AND lower(trim(first_name)) = lower(trim(p_first_name)) 
          AND lower(trim(last_name)) = lower(trim(p_last_name)))
  );
$$;
