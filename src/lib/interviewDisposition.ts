import { supabase } from "@/integrations/supabase/client";
import { promoteApplicationToAgent, type HireReceipt } from "@/lib/hireToOnboarding";

export type InterviewDispositionInput = { id: string; outcome: string; notes?: string; followupDueAt?: string | null };
export type InterviewDispositionReceipt = { receipt_id: string; can_undo: boolean; hire?: HireReceipt };
type InterviewSnapshot = { id: string; application_id: string | null; updated_at: string; outcome: string | null };
export type InterviewDispositionDeps = {
  load: (id: string) => Promise<InterviewSnapshot>;
  promote: (applicationId: string) => Promise<HireReceipt>;
  record: (params: Record<string, unknown>) => Promise<InterviewDispositionReceipt>;
};
const defaultDeps: InterviewDispositionDeps = {
  load: async (id) => {
    const { data, error } = await supabase.from("interview_events").select("id,application_id,updated_at,outcome").eq("id", id).single();
    if (error || !data) throw new Error(error?.message ?? "Interview could not be loaded.");
    return data;
  },
  promote: promoteApplicationToAgent,
  record: async (params) => {
    const { data, error } = await supabase.rpc("cc_record_interview_disposition" as never, params as never);
    if (error) throw new Error(error.message);
    const receipt = data as unknown as InterviewDispositionReceipt;
    if (!receipt?.receipt_id) throw new Error("No outcome receipt returned. Refresh before retrying.");
    return receipt;
  },
};

/** Hiring provisions through add-agent first; recording an outcome cannot manufacture an agent. */
export async function recordInterviewDisposition(input: InterviewDispositionInput, deps = defaultDeps): Promise<InterviewDispositionReceipt> {
  if (input.outcome === "callback" && (!input.followupDueAt || !Number.isFinite(Date.parse(input.followupDueAt)) || Date.parse(input.followupDueAt) <= Date.now())) {
    throw new Error("Choose a future callback date before saving.");
  }
  const row = await deps.load(input.id);
  if (row.outcome !== null) throw new Error("This interview already has an outcome. Refresh the queue before making a correction.");
  let hire: HireReceipt | undefined;
  if (input.outcome === "hired") {
    if (!row.application_id) throw new Error("Link the applicant's application before hiring so their account and onboarding can be created.");
    hire = await deps.promote(row.application_id);
  }
  try {
    const receipt = await deps.record({ p_id: row.id, p_outcome: input.outcome, p_notes: input.notes?.trim() || null,
      p_followup_due_at: input.followupDueAt ?? null, p_expected_updated_at: row.updated_at });
    return { ...receipt, ...(hire ? { hire, can_undo: false } : {}) };
  } catch (error) {
    if (hire) throw new Error(`The agent account exists, but the interview outcome was not confirmed: ${(error as Error).message}. Refresh the row; retry uses the same linked account.`);
    throw error;
  }
}

export async function undoInterviewDisposition(receiptId: string): Promise<void> {
  const { error } = await supabase.rpc("cc_undo_interview_disposition" as never, { p_receipt_id: receiptId } as never);
  if (error) throw new Error(error.message);
}
