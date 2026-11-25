import { supabase } from "@/integrations/supabase/client";

/** Browser state is never inherited from another login or the old global cache. */
export function myDayCacheKey(userId: string, part: "tasks" | "checks" | "pending", period?: string | number): string {
  if (!userId) throw new Error("Sign in to open your day");
  return `myday:v2:${encodeURIComponent(userId)}:${part}${period === undefined ? "" : `:${period}`}`;
}

export type TaskViewLease = () => boolean;
const openView: TaskViewLease = () => true;

/** Pin each request to the checked account, even if another login starts while it is pending. */
export async function taskAuthorization(expectedUserId: string, isCurrent: TaskViewLease = openView): Promise<string> {
  if (!isCurrent()) throw new Error("This task list is no longer open.");
  const { data, error } = await supabase.auth.getSession();
  if (!isCurrent()) throw new Error("This task list is no longer open.");
  if (error || !expectedUserId || data.session?.user.id !== expectedUserId || !data.session.access_token) throw new Error("Your account changed. Reopen this page.");
  return `Bearer ${data.session.access_token}`;
}

/** Supplement the page gate; database/Edge authorization remains authoritative. */
export async function assertSamTaskSession(expectedUserId: string, isCurrent: TaskViewLease = openView): Promise<string> {
  const authorization = await taskAuthorization(expectedUserId, isCurrent);
  const result = await supabase.rpc("is_sam").setHeader("Authorization", authorization);
  if (result.error || result.data !== true) throw new Error("This task list is private to Sam.");
  await taskAuthorization(expectedUserId, isCurrent);
  return authorization;
}
