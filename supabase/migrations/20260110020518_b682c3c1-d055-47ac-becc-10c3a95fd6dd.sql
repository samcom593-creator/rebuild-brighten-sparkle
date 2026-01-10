-- Fix security warnings by making the INSERT policies more specific

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Anyone can submit application" ON public.applications;
DROP POLICY IF EXISTS "System can insert logs" ON public.activity_logs;

-- Create more secure application insert policy (still public but with validation)
CREATE POLICY "Anyone can submit application with valid data" ON public.applications 
FOR INSERT WITH CHECK (
    first_name IS NOT NULL AND 
    last_name IS NOT NULL AND 
    email IS NOT NULL AND 
    phone IS NOT NULL AND
    status = 'new'
);

-- Activity logs should only be inserted by authenticated users or the system
CREATE POLICY "Authenticated users can log activity" ON public.activity_logs 
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());