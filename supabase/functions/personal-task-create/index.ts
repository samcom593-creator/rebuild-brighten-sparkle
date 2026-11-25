import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { PERSONAL_TASK_COLUMNS, TASK_AGENT_COLUMNS } from "../_shared/personal-task-contract.ts";
import { handlePersonalTaskCreate } from "../_shared/personal-task-handler.ts";

Deno.serve((req) => {
  let userClient: ReturnType<typeof createClient> | null = null;
  const caller = () => userClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  return handlePersonalTaskCreate(req, {
    getUser: async () => {
      const { data, error } = await caller().auth.getUser();
      return { userId: data.user?.id ?? null, error };
    },
    // Must use the caller's client. A service-role RPC has no caller identity.
    currentAgentId: () => caller().rpc("current_agent_id"),
    agentById: (id) => caller().from("agents").select(TASK_AGENT_COLUMNS).eq("id", id).maybeSingle(),
    insertTask: (input) => {
      // Reached only after authenticated ownership + active identity validation.
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      return service.from("agent_tasks").insert(input).select(PERSONAL_TASK_COLUMNS).single();
    },
  });
});
