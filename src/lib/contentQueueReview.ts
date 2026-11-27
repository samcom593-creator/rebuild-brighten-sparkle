import { supabase } from "@/integrations/supabase/client";
import type { WorkflowRpc } from "@/integrations/supabase/workflow-rpcs";

export async function reviewContentQueue(id: string, seenUpdatedAt: string, status: "APPROVED" | "REWORK"): Promise<void> {
  const { data, error } = await (supabase.rpc as unknown as WorkflowRpc)("content_queue_review_set_status", {
    p_content_id: id, p_seen_updated_at: seenUpdatedAt, p_status: status,
  });
  if (error) throw new Error(error.message);
  if (data === "changed") throw new Error("This clip changed. Refresh the queue and review it again.");
  if (data === "already_handled") throw new Error("This clip was already handled. Refresh the queue.");
  if (data !== status) throw new Error("The review was not confirmed. Refresh the queue before retrying.");
}
