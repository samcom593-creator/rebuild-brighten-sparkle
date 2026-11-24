/**
 * MP-304 · Contracting downlines (the Ethos lane) — client side.
 *
 * Everything here calls the contracting-downline edge function; the database owns every verdict
 * (submit_downline_contracting), every cap (the manager's own level) and every default (60% = Level 12,
 * "6 Month Advance"). This file formats, parses a spreadsheet paste, and reads responses. It invents nothing.
 */
import { supabase } from "@/integrations/supabase/client";

// Sam, 2026-11-23: comp is shown and written as a PERCENT ("60%"); the Ethos "Level N" is internal vocabulary only.
export const ETHOS_LEVELS: ReadonlyArray<{ pct: number; level: string }> = Array.from({ length: 16 }, (_, i) => ({ pct: 60 + i * 5, level: `Level ${12 + i}` }));
export const pctLabel = (pct: number | null | undefined): string => (pct == null || !Number.isFinite(Number(pct)) ? "60%" : `${Number(pct)}%`);
export const ADVANCE_TIER = "6 Month Advance";
export const MGN_DEFAULT = "https://mgnagenthub.com/dashboard";

export type DownlineRow = {
  row_key?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  npn: string;
  comp_pct?: number | null;
  request_type?: "contracting" | "transfer";
  license_attested?: boolean;
  eo_attested?: boolean;
  confirm_downgrade?: boolean;
  confirm_near_duplicate?: boolean;
  reason?: string;
  upline_agent_id?: string | null;
};

export type VerdictCode = "ok" | "needs_fix" | "would_downgrade_comp" | "npn_near_duplicate" | "npn_belongs_to_other_team" | "email_belongs_to_other" | "ambiguous_upline" | "error";

export type Verdict = {
  row_key?: string;
  ok: boolean;
  verdict: VerdictCode;
  field?: string | null;
  message?: string;
  suggestion?: string | null;
  matches?: Array<{ kind?: string; display: string; npn: string }>;
  current_pct?: number; proposed_pct?: number; cap_pct?: number;
  existing_agent_id?: string | null; existing_name?: string | null; existing_pct?: number | null;
  upline_id?: string; upline_name?: string; sub_agency?: string;
  comp_pct?: number; level?: string; advance?: string; request_type?: string;
  email?: string; phone?: string; npn?: string;
  review?: Array<{ code: string; message: string }>;
  intake_id?: string; agent_id?: string | null; delivery?: string; provisioned?: boolean; provision_error?: string | null;
  dry_run?: boolean;
};

export const VERDICT_COPY: Record<VerdictCode, { label: string; tone: "ok" | "warn" | "block" }> = {
  ok: { label: "Ready", tone: "ok" },
  needs_fix: { label: "Needs a fix", tone: "warn" },
  would_downgrade_comp: { label: "Would lower comp", tone: "block" },
  npn_near_duplicate: { label: "NPN one digit from an existing one", tone: "block" },
  npn_belongs_to_other_team: { label: "NPN is on another team", tone: "block" },
  email_belongs_to_other: { label: "Email belongs to someone else", tone: "block" },
  ambiguous_upline: { label: "Upline not resolved", tone: "block" },
  error: { label: "Could not check", tone: "block" },
};

export type Actor = {
  ok: boolean; error?: string;
  user_id?: string; agent_id?: string | null; display_name?: string | null; is_admin?: boolean; is_manager?: boolean;
  ref_slug?: string | null; npn?: string | null;
  cap_pct?: number | null; cap_level?: string | null; default_pct?: number; default_level?: string; advance_tier?: string;
  sub_agency_label?: string | null; mgn_url?: string | null; join_path?: string | null; writes_enabled?: boolean;
};

export type BoardRow = {
  agent_id: string | null; intake_id: string | null; display_name: string; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null; npn: string | null; agent_status: string; manager_id: string | null; manager_name: string | null;
  comp_pct: number | null; comp_source: string | null; ethos_level: string | null;
  intake_status: string | null; ethos_state: string | null; ethos_note: string | null; ethos_delivered_at: string | null;
  on_sheet: boolean; sheet_level: string | null; sheet_sub_agency: string | null; sheet_row: number | null;
  last_update_status: string | null; last_update_at: string | null;
};

type FnResult<T> = { data: T | null; error: string | null; status: number };

async function call<T>(body: Record<string, unknown>): Promise<FnResult<T>> {
  const { data, error } = await supabase.functions.invoke("contracting-downline", { body });
  if (error) {
    // FunctionsHttpError.context is the raw Response; read the body or every refusal reads "non-2xx".
    const ctx = (error as { context?: Response })?.context;
    let parsed: Record<string, unknown> | null = null;
    if (ctx && typeof ctx.clone === "function") {
      try { parsed = (await ctx.clone().json()) as Record<string, unknown>; } catch { // empty-catch-allow:jsonparse-fallback
        parsed = null;
      }
    }
    if (parsed && typeof parsed === "object") return { data: parsed as T, error: String(parsed.error ?? parsed.message ?? error.message), status: ctx?.status ?? 400 };
    return { data: null, error: error.message ?? "Request failed", status: ctx?.status ?? 0 };
  }
  return { data: (data ?? null) as T, error: null, status: 200 };
}

export const contractingDownlines = {
  resolve: (slug: string) => call<{ ok: boolean; manager_name?: string; sub_agency?: string; redirect_host?: string; custom_link?: boolean; error?: string }>({ action: "resolve", slug }),
  join: (slug: string, fields: Record<string, unknown>) => call<Verdict & { redirect_url?: string; parked?: boolean; next?: string; manager_name?: string }>({ action: "join", slug, ...fields }),
  actor: () => call<Actor>({ action: "actor" }),
  verdict: (rows: DownlineRow[]) => call<{ ok: boolean; results: Verdict[]; total: number; written: number; held: number }>({ action: "verdict", rows }),
  submit: (rows: DownlineRow[]) => call<{ ok: boolean; results: Verdict[]; total: number; written: number; held: number }>({ action: "submit", rows }),
  update: (payload: Record<string, unknown>) => call<{ ok: boolean; field?: string; message?: string; suggestion?: string; update_id?: string | null; changes?: string[]; queued?: boolean; level?: string | null }>({ action: "update", ...payload }),
  setMgnLink: (url: string) => call<{ ok: boolean; url?: string | null; join_path?: string; error?: string; field?: string }>({ action: "mgn_link", url }),
  downlines: () => call<{ ok: boolean; rows: BoardRow[] }>({ action: "downlines" }),
  refreshSheet: () => call<{ ok: boolean; refreshed: boolean; mirror_at?: string; note?: string }>({ action: "refresh_sheet" }),
};

// ── Spreadsheet paste → rows ────────────────────────────────────────────────────────────────────
//
// Accepts what a manager copies out of a sheet (tab-separated) or a CSV export. The header row is matched by
// meaning, not position, so "NPN", "Agent NPN", "National Producer Number" all land in the same column. Columns
// that are not understood are ignored and reported, never guessed into a field.

const HEADER_ALIASES: Array<[keyof DownlineRow, RegExp]> = [
  ["first_name", /^(agent\s*)?(first|given)(\s*name)?(\s*\(as appears on license\))?$/i],
  ["last_name", /^(agent\s*)?(last|sur|family)(\s*name)?(\s*\(as appears on license\))?$/i],
  ["email", /^(agent\s*)?e-?mail(\s*address)?$/i],
  ["phone", /^(agent\s*)?(mobile|phone|cell)(\s*number)?$/i],
  ["npn", /^(agent\s*)?(npn|national producer number)$/i],
  ["comp_pct", /^(comp(ensation)?|commission)(\s*(level|%|pct|percent))?$/i],
  ["request_type", /^(request\s*type|type)$/i],
];

export type ParsedGrid = { rows: DownlineRow[]; ignoredHeaders: string[]; delimiter: "\t" | ","; header: string[] };

function splitLine(line: string, delimiter: "\t" | ","): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (ch === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "Level 14" → 70; "70%" → 70; "70" → 70; blank → null (the server applies the default). */
export function parseCompCell(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const lvl = /^level\s*(\d{1,2})$/i.exec(s);
  if (lvl) return 60 + (Number(lvl[1]) - 12) * 5;
  const n = Number(s.replace(/%$/, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function parseGrid(text: string): ParsedGrid {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], ignoredHeaders: [], delimiter: "\t", header: [] };
  const delimiter: "\t" | "," = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delimiter);
  const map: Array<keyof DownlineRow | null> = header.map((h) => HEADER_ALIASES.find(([, re]) => re.test(h.trim()))?.[0] ?? null);
  const ignoredHeaders = header.filter((_, i) => map[i] === null && header[i].trim() !== "");
  const rows: DownlineRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitLine(lines[li], delimiter);
    const r: DownlineRow = { row_key: String(li), first_name: "", last_name: "", email: "", phone: "", npn: "" };
    cells.forEach((c, i) => {
      const k = map[i]; if (!k) return;
      if (k === "comp_pct") r.comp_pct = parseCompCell(c);
      else if (k === "request_type") r.request_type = /transfer/i.test(c) ? "transfer" : "contracting";
      else (r as Record<string, unknown>)[k] = c;
    });
    if (r.first_name || r.last_name || r.email || r.npn) rows.push(r);
  }
  return { rows, ignoredHeaders, delimiter, header };
}

export function levelFor(pct: number | null | undefined): string {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "Level 12";
  return `Level ${Math.min(27, Math.max(12, 12 + Math.round((n - 60) / 5)))}`;
}

// ── One plain stage per person (MP-304 "Grow my team") ──────────────────────────────────────────
export type DownlineStage = { key: "login_pending" | "licensing" | "ready" | "adding" | "held" | "on_sheet"; label: string; tone: "ok" | "pending" | "warn" | "muted"; hint: string };

/** Ordered so a manager reads the row left to right as a journey; the board sorts on `order`. */
export const STAGE_ORDER: Record<DownlineStage["key"], number> = { held: 0, ready: 1, login_pending: 2, adding: 3, licensing: 4, on_sheet: 5 };

export function downlineStage(r: Pick<BoardRow, "agent_status" | "npn" | "on_sheet" | "ethos_state" | "ethos_note">): DownlineStage {
  if (r.on_sheet) return { key: "on_sheet", label: "On MGN's sheet", tone: "ok", hint: "Contracting sent. MGN/Ethos take it from here." };
  if (r.agent_status === "intake_only") return { key: "login_pending", label: "Joined — login not made", tone: "warn", hint: "Their details are saved; an admin finishes the login." };
  if (!r.npn) return { key: "licensing", label: "Getting licensed", tone: "muted", hint: "When they have an NPN they open your Join link again." };
  if (r.ethos_state === "queued" || r.ethos_state === "attempting") return { key: "adding", label: "Being added to the sheet", tone: "pending", hint: "Usually under a minute." };
  if (r.ethos_state === "manual_review") return { key: "held", label: "Held — needs a look", tone: "warn", hint: r.ethos_note ?? "Something on this person conflicts with another record." };
  return { key: "ready", label: "Ready — not on the sheet", tone: "warn", hint: "Licensed with an NPN. Tap Add to sheet." };
}
