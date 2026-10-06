import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";
import type { ContactChannel, ContactOutcome, WorklistRow } from "@/lib/recruitingQueues";

/**
 * Data layer for the recruiting worklist.
 *
 * Reads `applications` directly under the viewer's RLS (admin/VA/recruiter: everyone;
 * manager: their team; attributed agent: their own), page by page past PostgREST's
 * 1000-row cap, so every queue count is over the FULL set the viewer can reach —
 * never a silent .limit().
 *
 * Writes go ONLY through record_recruiting_outcome() / set_recruiting_plan(): one
 * SECURITY DEFINER call that logs, stamps and plans atomically and returns the
 * updated row, which replaces the cached row so the queue and the person panel
 * change together.
 *
 * The new relations/RPCs are not in the generated types until the command center
 * regenerates them, so this file talks to the client through a narrow untyped
 * facade instead of `any`.
 */

type DbError = { message: string; code?: string | null; details?: string | null };
type QueryResult<T> = { data: T | null; error: DbError | null; count?: number | null };

interface UntypedQuery<T> extends PromiseLike<QueryResult<T>> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): UntypedQuery<T>;
  eq(column: string, value: unknown): UntypedQuery<T>;
  neq(column: string, value: unknown): UntypedQuery<T>;
  is(column: string, value: null | boolean): UntypedQuery<T>;
  or(filters: string): UntypedQuery<T>;
  order(column: string, options?: { ascending?: boolean }): UntypedQuery<T>;
  range(from: number, to: number): UntypedQuery<T>;
}

interface UntypedClient {
  from(relation: string): UntypedQuery<unknown[]>;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}

const db = supabase as unknown as UntypedClient;

export const WORKLIST_PAGE_SIZE = 1000;

const BASE_COLUMNS = [
  "id", "first_name", "last_name", "email", "phone", "state", "license_status", "license_progress", "status",
  "next_step_stage_key", "created_at", "assigned_agent_id", "last_contacted_at", "next_action", "next_action_due_at",
  "next_step_due_at", "phone_bad_at", "email_bad_at", "sms_consent_given", "email_consent_given",
] as const;

/** Columns added by 20261006120000_recruiting_contact_outcomes.sql. */
const WORKSPACE_COLUMNS = [
  "time_zone", "time_zone_source", "recruiting_owner_user_id", "last_contact_outcome", "last_contact_outcome_at",
  "last_contact_channel", "next_action_set_at", "waiting_reason", "next_review_at", "do_not_contact_at",
] as const;

export const WORKLIST_SELECT = [...BASE_COLUMNS, ...WORKSPACE_COLUMNS].join(",");
export const WORKLIST_SELECT_LEGACY = BASE_COLUMNS.join(",");

function isMissingColumn(error: DbError | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message);
}

function normaliseRow(raw: Record<string, unknown>): WorklistRow {
  const out: Record<string, unknown> = { ...raw };
  for (const col of WORKSPACE_COLUMNS) if (!(col in out)) out[col] = null;
  return out as unknown as WorklistRow;
}

/** A worklist-eligible record: live, a real application (not an interview booking), not a known duplicate. */
function scopeWorklist<T>(q: UntypedQuery<T>): UntypedQuery<T> {
  return q
    .is("terminated_at", null)
    .eq("record_type", APPLICATION_RECORD_TYPE)
    .or("is_duplicate.is.null,is_duplicate.eq.false");
}

/**
 * Fetch every page until a short page arrives. `fetchPage` is injected so the
 * pagination contract is testable without a network.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QueryResult<T[]>>,
  pageSize = WORKLIST_PAGE_SIZE,
): Promise<{ rows: T[]; error: DbError | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}

export interface WorklistCoverage {
  /** Live records (terminated_at null) of every record type the viewer can see. */
  live: number | null;
  duplicates: number | null;
  nonApplication: number | null;
}

export interface WorklistData {
  rows: WorklistRow[];
  /** false when the workspace migration is not applied yet: read-only, legacy columns. */
  backendReady: boolean;
  coverage: WorklistCoverage;
  loadedAt: string;
}

async function countLive(apply: (q: UntypedQuery<unknown[]>) => UntypedQuery<unknown[]>): Promise<number | null> {
  const { count, error } = await apply(db.from("applications").select("id", { count: "exact", head: true }));
  return error ? null : count ?? null;
}

export async function loadWorklist(): Promise<WorklistData> {
  const page = (columns: string) => (from: number, to: number) =>
    scopeWorklist(db.from("applications").select(columns))
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to) as PromiseLike<QueryResult<Record<string, unknown>[]>>;

  let backendReady = true;
  let result = await fetchAllPages(page(WORKLIST_SELECT));
  if (isMissingColumn(result.error)) {
    backendReady = false;
    result = await fetchAllPages(page(WORKLIST_SELECT_LEGACY));
  }
  if (result.error) throw new Error(result.error.message);

  const [live, duplicates, nonApplication] = await Promise.all([
    countLive((q) => q.is("terminated_at", null)),
    countLive((q) => q.is("terminated_at", null).eq("record_type", APPLICATION_RECORD_TYPE).eq("is_duplicate", true)),
    countLive((q) => q.is("terminated_at", null).neq("record_type", APPLICATION_RECORD_TYPE)),
  ]);

  return {
    rows: result.rows.map(normaliseRow),
    backendReady,
    coverage: { live, duplicates, nonApplication },
    loadedAt: new Date().toISOString(),
  };
}

export const WORKLIST_QUERY_KEY = ["recruiting-worklist", "v1"] as const;

export function useRecruitingWorklist(enabled: boolean) {
  return useQuery({
    queryKey: WORKLIST_QUERY_KEY,
    queryFn: loadWorklist,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export interface StaffMember {
  user_id: string;
  display_name: string;
  roles: string[];
}

export function useRecruitingStaff(enabled: boolean) {
  return useQuery({
    queryKey: ["recruiting-worklist", "staff-directory"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ staff: StaffMember[]; available: boolean }> => {
      const { data, error } = await db.rpc("recruiting_staff_directory");
      if (error) return { staff: [], available: false };
      return { staff: (data as StaffMember[] | null) ?? [], available: true };
    },
  });
}

export interface StageDefinition {
  stage_key: string;
  display_name: string;
  order_index: number;
  is_terminal: boolean;
}

export function useRecruitingStages() {
  return useQuery({
    queryKey: ["recruiting-worklist", "stages"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<StageDefinition[]> => {
      const { data, error } = await db
        .from("next_step_stages")
        .select("stage_key,display_name,order_index,is_terminal,retired_at")
        .is("retired_at", null)
        .order("order_index", { ascending: true });
      if (error) throw new Error(error.message);
      return (data as StageDefinition[] | null) ?? [];
    },
  });
}

export interface ContactHistoryEntry {
  id: string;
  channel: string;
  outcome: string;
  contact_outcome: string | null;
  notes: string | null;
  logged_by: string | null;
  logged_at: string;
  next_action: string | null;
  next_action_due_at: string | null;
  waiting_reason: string | null;
  next_review_at: string | null;
  is_manual: boolean | null;
}

export function useContactHistory(applicationId: string | null, backendReady: boolean) {
  return useQuery({
    queryKey: ["recruiting-worklist", "history", applicationId, backendReady],
    enabled: Boolean(applicationId),
    staleTime: 15_000,
    queryFn: async (): Promise<ContactHistoryEntry[]> => {
      const columns = backendReady
        ? "id,channel,outcome,contact_outcome,notes,logged_by,logged_at,next_action,next_action_due_at,waiting_reason,next_review_at,is_manual"
        : "id,channel,outcome,notes,logged_by,logged_at";
      const { data, error } = await db
        .from("application_contact_log")
        .select(columns)
        .eq("application_id", applicationId)
        .order("logged_at", { ascending: false })
        .range(0, 49);
      if (error) throw new Error(error.message);
      return ((data as Array<Partial<ContactHistoryEntry>> | null) ?? []).map((r) => ({
        contact_outcome: null,
        next_action: null,
        next_action_due_at: null,
        waiting_reason: null,
        next_review_at: null,
        is_manual: null,
        ...r,
      })) as ContactHistoryEntry[];
    },
  });
}

export interface RecordOutcomeInput {
  applicationId: string;
  outcome: ContactOutcome;
  channel: ContactChannel;
  notes: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  waitingReason: string | null;
  nextReviewAt: string | null;
  ownerUserId: string | null;
  /** The raw last_contact_outcome_at the viewer saw; the server refuses a stale save. */
  expectedLastOutcomeAt: string | null;
}

export interface SetPlanInput {
  applicationId: string;
  updateOwner: boolean;
  ownerUserId: string | null;
  updatePlan: boolean;
  nextAction: string | null;
  nextActionDueAt: string | null;
  waitingReason: string | null;
  nextReviewAt: string | null;
  timeZone: string | null;
  notes: string | null;
  expectedPlanSetAt: string | null;
}

export class WorklistSaveError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "WorklistSaveError";
  }
}

function toRow(data: unknown): WorklistRow {
  if (!data || typeof data !== "object") throw new WorklistSaveError("The server returned no updated row.", null);
  return normaliseRow(data as Record<string, unknown>);
}

/** Replace one row in the cached worklist so queue + panel update from the same response. */
export function mergeRow(data: WorklistData | undefined, row: WorklistRow): WorklistData | undefined {
  if (!data) return data;
  const idx = data.rows.findIndex((r) => r.id === row.id);
  if (idx === -1) return { ...data, rows: [row, ...data.rows] };
  const rows = data.rows.slice();
  rows[idx] = { ...rows[idx], ...row };
  return { ...data, rows };
}

export function useWorklistMutations() {
  const queryClient = useQueryClient();

  const applyRow = useCallback(
    (row: WorklistRow) => {
      queryClient.setQueryData<WorklistData>(WORKLIST_QUERY_KEY, (prev) => mergeRow(prev, row));
      void queryClient.invalidateQueries({ queryKey: ["recruiting-worklist", "history", row.id] });
    },
    [queryClient],
  );

  const recordOutcome = useMutation({
    mutationFn: async (input: RecordOutcomeInput): Promise<WorklistRow> => {
      const { data, error } = await db.rpc("record_recruiting_outcome", {
        p_application_id: input.applicationId,
        p_outcome: input.outcome,
        p_channel: input.channel,
        p_notes: input.notes,
        p_next_action: input.nextAction,
        p_next_action_due_at: input.nextActionDueAt,
        p_waiting_reason: input.waitingReason,
        p_next_review_at: input.nextReviewAt,
        p_owner_user_id: input.ownerUserId,
        p_expected_last_outcome_at: input.expectedLastOutcomeAt,
        p_check_conflict: true,
        p_source_surface: "recruiting_worklist",
      });
      if (error) throw new WorklistSaveError(error.message, error.code ?? null);
      return toRow(data);
    },
    onSuccess: applyRow,
  });

  const setPlan = useMutation({
    mutationFn: async (input: SetPlanInput): Promise<WorklistRow> => {
      const { data, error } = await db.rpc("set_recruiting_plan", {
        p_application_id: input.applicationId,
        p_update_owner: input.updateOwner,
        p_owner_user_id: input.ownerUserId,
        p_update_plan: input.updatePlan,
        p_next_action: input.nextAction,
        p_next_action_due_at: input.nextActionDueAt,
        p_waiting_reason: input.waitingReason,
        p_next_review_at: input.nextReviewAt,
        p_time_zone: input.timeZone,
        p_notes: input.notes,
        p_expected_plan_set_at: input.expectedPlanSetAt,
        p_check_conflict: true,
      });
      if (error) throw new WorklistSaveError(error.message, error.code ?? null);
      return toRow(data);
    },
    onSuccess: applyRow,
  });

  return { recordOutcome, setPlan };
}
