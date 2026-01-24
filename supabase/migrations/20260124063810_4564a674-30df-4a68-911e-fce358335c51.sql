
-- Remove the foreign key constraint on user_roles.user_id to allow manual role assignment
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
