-- Enable realtime for applications table
ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;

-- Enable realtime for agents table
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;