-- Grant admin access to info@kingofsales.net user
UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id = '4491dc82-a056-4fb3-ab38-b132afffb700';

-- Create an active agent record for this user
INSERT INTO public.agents (user_id, status, license_status)
SELECT '4491dc82-a056-4fb3-ab38-b132afffb700', 'active', 'licensed'
WHERE NOT EXISTS (
  SELECT 1 FROM public.agents WHERE user_id = '4491dc82-a056-4fb3-ab38-b132afffb700'
);