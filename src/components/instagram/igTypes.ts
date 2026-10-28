// Shape of fn_ig_dashboard v2 (migration 20261028053436). Cast ONCE at the query boundary in
// InstagramInbox.tsx; types.ts cannot be regenerated (the Supabase PAT is dead), so this file is
// the contract and the RPC header comment is its twin.
export type IgStatusWord =
  | "call" | "today" | "closing" | "reply" | "tag_it" | "closed"
  | "casual" | "open" | "snoozed" | "handled" | "booked" | "applied";

export interface IgBookedEvent {
  id: string;
  scheduled_at: string;
  invitee_phone: string | null;
  invitee_name: string | null;
  outcome: string | null;
  event_type_name?: string | null;
}

export interface IgRow {
  external_id: string;
  handle: string | null;
  name: string | null;
  status: IgStatusWord;
  rank: number;
  last_body: string | null;
  last_direction: "inbound" | "outbound" | null;
  last_at: string | null;
  last_inbound_at: string | null;
  last_inbound_id?: string | null;
  age_min: number | null;
  window_closes_at?: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  licensed: boolean;
  human_lane: boolean;
  booked_event: IgBookedEvent | null;
  has_booking: boolean;
  applied: boolean;
  application_id?: string | null;
  applied_by?: "link" | "handle" | null;
  tag_refused_at?: string | null;
  handled_at?: string | null;
  snoozed_until?: string | null;
  note?: string | null;
  told_locked_in?: boolean;
  recovered?: boolean;
  sent_at?: string | null;
}

export interface IgStatus {
  token_ok: boolean | null;
  token_checked_at: string | null;
  ig_username: string;
  links_blocked: boolean;
  links_blocked_at: string | null;
  last_link_refusal_at: string | null;
  links_proven_at: string | null;
  last_delivered_at: string | null;
  last_bot_delivered_at: string | null;
  last_inbound_at: string | null;
  nudge_cron_last_at: string | null;
  nudge_cron_last_status: string | null;
  human_agent_supported: boolean;
  window: string;
  since: string;
  prior_since: string;
  generated_at: string;
}

export type IgLeverKey = "locked_in_gap" | "business_number" | "number_booked" | "booked_showed" | "none";

export interface IgLever {
  key: IgLeverKey;
  sentence: string;
  button_label: string | null;
  people: IgRow[];
  lost: { business_number: number; number_booked: number; booked_showed: number };
}

export type IgStageKey = "in" | "business" | "licensed" | "number" | "booked" | "showed" | "applied" | "hired" | "recovered";

export interface IgStage {
  key: IgStageKey;
  label: string;
  caption: string;
  count: number;
  prior_count: number;
  prev_key: IgStageKey | null;
  people: IgRow[];
  or_email?: number;
  split?: { by_link?: number; by_handle?: number; no_show?: number; not_marked?: number; recovered?: number; emailed?: number; prior_emailed?: number };
}

export interface IgFunnel {
  since: string;
  prior_since: string;
  locked_in_gap: number;
  locked_in_people: IgRow[];
  stages: IgStage[];
}

export interface IgReel {
  external_id: string;
  title: string | null;
  url: string | null;
  views: number | null;
  posted_at: string | null;
  people_in: number;
  want_in: number;
}

export interface IgLine { line: string; sends: number; replies: number; reply_rate: number }

export interface IgWorking {
  reels: IgReel[];
  top_views: IgReel | null;
  lines: IgLine[];
  sam_short_pct: number | null;
  bot_long_pct: number | null;
  intents: { intent: string; people: number }[];
}

export interface IgNudged {
  external_id: string; handle: string | null; tag: string | null; body: string; at: string;
  delivered: boolean; refused: boolean; send_failed_kind: string | null; replied: boolean;
}
export interface IgRecovery { id: string; email: string; first_name: string | null; sent_at: string; recovered: boolean }

export interface IgHealth {
  bot_handed: number;
  bot_receipts: number;
  you_delivered: number;
  you_got_reply: number;
  replied_24h_n: number;
  replied_24h_of: number;
  refused_30d: number;
  comment_refused_7d: number;
  followups_sent_30d: number;
  followup_last_run_at: string | null;
  followup_last_status: string | null;
  nudged: IgNudged[];
  recovery: IgRecovery[];
}

export interface IgDashboard {
  status: IgStatus;
  needs: IgRow[];
  everyone: IgRow[];
  later: IgRow[];
  lever: IgLever;
  funnel: IgFunnel;
  working: IgWorking;
  health: IgHealth;
  people: IgRow[];
}

export interface IgThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  intent: string | null;
  auto_replied: boolean | null;
  received_at: string;
  mid: string | null;
  send_failed_kind: string | null;
  error: string | null;
  queued: string | null;
  tag: string | null;
  path: string | null;
  link_stripped: boolean;
}

export interface IgThread { external_id: string; handle: string | null; name: string | null; messages: IgThreadMessage[] }

/** Where a row is being rendered; decides which 'more' items show. */
export type IgRowContext = "list" | "everyone" | "later" | "people" | "sheet";
