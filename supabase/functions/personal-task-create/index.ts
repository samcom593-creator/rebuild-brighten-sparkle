import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { handlePersonalTaskCreate } from "./handler.ts";

Deno.serve((req) => {
  const createCaller = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  let userClient: ReturnType<typeof createCaller> | null = null;
  const caller = () => userClient ??= createCaller();
  return handlePersonalTaskCreate(req, {
    getUser: async () => {
      const { data, error } = await caller().auth.getUser();
      return { userId: data.user?.id ?? null, error };
    },
    // Must use the caller's client. A service-role RPC has no caller identity.
    taskIdentity: () => caller().rpc("personal_task_identity"),
    createTask: (input) => caller().rpc("personal_task_create", {
      p_agent_id: input.agent_id, p_title: input.title, p_description: input.description,
      p_due_date: input.due_date, p_priority: input.priority,
    }),
  });
});
