-- Drop the overly restrictive policy that blocks public INSERT
-- The existing specific policies already provide adequate protection:
-- - INSERT: restricted to safe initial values (status='new', no admin fields)
-- - SELECT/UPDATE/DELETE: already scoped to authenticated users via specific policies
DROP POLICY IF EXISTS "Deny public access to applications" ON public.applications;