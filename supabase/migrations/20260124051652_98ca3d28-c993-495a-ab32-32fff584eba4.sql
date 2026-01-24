-- Create license_progress enum type for 5-step license progression
CREATE TYPE public.license_progress AS ENUM (
  'unlicensed',
  'course_purchased',
  'passed_test',
  'waiting_on_license',
  'licensed'
);

-- Add license_progress column to applications table
ALTER TABLE public.applications 
ADD COLUMN license_progress public.license_progress DEFAULT 'unlicensed';

-- Sync existing data based on current license_status
UPDATE public.applications SET license_progress = 
  CASE 
    WHEN license_status = 'licensed' THEN 'licensed'::public.license_progress
    WHEN license_status = 'pending' THEN 'waiting_on_license'::public.license_progress
    ELSE 'unlicensed'::public.license_progress
  END;