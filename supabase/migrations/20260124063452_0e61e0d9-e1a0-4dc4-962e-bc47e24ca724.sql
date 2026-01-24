
-- Remove the foreign key constraint on profiles.user_id to allow manual agent creation
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

-- Add a comment explaining why this constraint was removed
COMMENT ON COLUMN public.profiles.user_id IS 'User identifier - may reference auth.users for authenticated users, or be a generated UUID for manually-created agent profiles';
