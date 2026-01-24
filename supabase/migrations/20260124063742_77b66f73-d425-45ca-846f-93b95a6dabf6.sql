
-- Remove the foreign key constraint on agents.user_id to allow manual agent creation
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_user_id_fkey;

-- Add a comment explaining why this constraint was removed
COMMENT ON COLUMN public.agents.user_id IS 'User identifier - may reference auth.users for authenticated users, or be a generated UUID for manually-created agent records';
