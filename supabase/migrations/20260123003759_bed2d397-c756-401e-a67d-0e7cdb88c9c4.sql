-- Remove the public SELECT policy that exposes tokens to unauthenticated users
-- Token validation is already handled securely via the validate-signup-token edge function
-- which uses the service role key for server-side access

DROP POLICY IF EXISTS "Anyone can view active tokens for validation" ON public.manager_signup_tokens;