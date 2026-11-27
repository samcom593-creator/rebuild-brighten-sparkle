import type { Json } from "./types";

/** Authored migration contracts kept separate from the generated database snapshot. */
export interface WorkflowFunctions {
  training_canonical_self_id: { Args: undefined; Returns: string };
  training_progress_access: { Args: undefined; Returns: Json };
  social_draft_review: { Args: { p_id: number }; Returns: Json };
  approve_social_draft: { Args: { p_id: number; p_seen_hash: string }; Returns: string };
  social_draft_review_set_status: {
    Args: { p_id: number; p_seen_hash: string; p_status: string }; Returns: string;
  };
  content_queue_review_set_status: {
    Args: { p_content_id: string; p_seen_updated_at: string; p_status: string }; Returns: string;
  };
  deal_coverage_review_queue: { Args: undefined; Returns: Json };
  decide_deal_coverage_review: {
    Args: { p_review_id: string; p_decision: string; p_reason: string; p_expected_version: number };
    Returns: Json;
  };
  resume_deal_coverage_review: {
    Args: { p_review_id: string; p_expected_version: number }; Returns: Json;
  };
}

export type WorkflowRpc = <Name extends keyof WorkflowFunctions>(
  name: Name,
  ...args: WorkflowFunctions[Name]["Args"] extends undefined
    ? [args?: undefined]
    : [args: WorkflowFunctions[Name]["Args"]]
) => PromiseLike<{
  data: WorkflowFunctions[Name]["Returns"] | null;
  error: { message: string } | null;
}>;
