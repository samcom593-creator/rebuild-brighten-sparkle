import { supabase } from "@/integrations/supabase/client";

interface InvokeResult {
  success: boolean;
  data: any;
  channelSummary?: string;
}

/**
 * Wrapper around supabase.functions.invoke that properly checks for errors
 * and returns truthful success/failure status.
 */
export async function invokeEdge(
  functionName: string,
  body: Record<string, any>
): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    throw new Error(error.message || `${functionName} failed`);
  }

  // If the function explicitly says success: false
  if (data && data.success === false) {
    throw new Error(data.error || `${functionName} reported failure`);
  }

  // Build channel summary for notification functions
  let channelSummary: string | undefined;
  if (data?.channels) {
    const ch = data.channels;
    const parts: string[] = [];
    if (ch.push !== undefined) parts.push(ch.push ? "Push ✓" : "Push ✗");
    if (ch.sms !== undefined) parts.push(ch.sms ? "SMS ✓" : "SMS ✗");
    if (ch.email !== undefined) parts.push(ch.email ? "Email ✓" : "Email ✗");
    channelSummary = parts.join(", ");

    // If ALL channels failed, treat as failure
    const anySuccess = ch.push || ch.sms || ch.email;
    if (!anySuccess) {
      throw new Error(`All channels failed: ${channelSummary}`);
    }
  }

  return { success: true, data, channelSummary };
}
