// Audit log writer
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuditEntry {
  actorUserId?: string;
  actorRole?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export async function writeAudit(serviceClient: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    await serviceClient.from("audit_log").insert({
      actor_user_id: entry.actorUserId ?? null,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      before_data: entry.beforeData ?? null,
      after_data: entry.afterData ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      request_id: entry.requestId ?? null,
    });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

export async function logFunctionError(
  serviceClient: SupabaseClient,
  functionName: string,
  err: unknown,
  payload?: unknown,
  userId?: string,
  requestId?: string
): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await serviceClient.from("function_errors").insert({
      function_name: functionName,
      error_message: message,
      error_stack: stack ?? null,
      request_payload: payload ?? null,
      user_id: userId ?? null,
      request_id: requestId ?? null,
    });
  } catch (e) {
    console.error("[audit] error log failed:", e);
  }
}
