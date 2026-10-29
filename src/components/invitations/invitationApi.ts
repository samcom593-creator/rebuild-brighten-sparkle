/**
 * Data access for personal invitations. Every call goes through a SECURITY
 * DEFINER RPC from 20261006140000_invitation_lifecycle.sql; the raw
 * invite_tokens table is never read or written from the client.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { InvitationStatus } from "@/lib/invitationState";
import type { InviteLinkKind, ShareChannel } from "@/lib/recruitLinks";

export interface InviteMintOptions {
  is_admin: boolean;
  is_manager: boolean;
  caller_agent_id: string | null;
  cap_pct: number | null;
  can_offer_comp: boolean;
  comp_levels: number[];
  roles: string[];
  uplines: Array<{ id: string; name: string; agency_key: string; is_self: boolean }>;
  carriers: Array<{ id: string; name: string }>;
}

export interface InvitationRow {
  id: string;
  kind: "hire" | "join";
  status: InvitationStatus;
  notes: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  target_role: string | null;
  target_manager_id: string | null;
  upline_name: string | null;
  agency_key: string | null;
  offered_comp_pct: number | null;
  carrier_exceptions: Array<{ carrier_name: string; pct: number }> | null;
  created_at: string;
  created_by_name: string | null;
  /** Null for a permanent link (permanent true); the server never sends 'infinity'. */
  expires_at: string | null;
  /** OVERHAUL-1: true when the link never expires. Missing (an older server) reads as temporary. */
  permanent?: boolean;
  /** The license path the link was minted with, or null when the recruit chooses. */
  license_status?: "licensed" | "unlicensed" | null;
  used_at: string | null;
  accepted_agent_name: string | null;
  revoked_at: string | null;
  superseded_at: string | null;
  share_count: number;
  last_shared_at: string | null;
}

interface InvitationList {
  counts: Record<InvitationStatus | "total", number>;
  rows: InvitationRow[];
  limit: number;
}

export const inviteUrlFromPath = (path: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;

export function useInviteMintOptions(enabled = true) {
  return useQuery({
    queryKey: ["invitation-mint-options"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<InviteMintOptions> => {
      const { data, error } = await supabase.rpc("invitation_mint_options" as never);
      if (error) throw error;
      const raw = (data ?? {}) as unknown as InviteMintOptions;
      return {
        ...raw,
        cap_pct: raw.cap_pct == null ? null : Number(raw.cap_pct),
        comp_levels: (raw.comp_levels ?? []).map(Number),
        roles: raw.roles ?? [],
        uplines: raw.uplines ?? [],
        carriers: raw.carriers ?? [],
      };
    },
  });
}

/**
 * A share is recorded as SHARED, never as delivered: copy, the share sheet, a text draft and an
 * email draft all hand the link to the person, and nothing on these pages sends anything.
 */
export async function shareInvitation(id: string, channel: ShareChannel) {
  const { data, error } = await supabase.rpc("record_invitation_share" as never, {
    p_id: id,
    p_channel: channel,
  } as never);
  if (error) throw error;
  return data as unknown as { ok: boolean; status: string; path?: string; recipient_email?: string | null };
}

/**
 * One page, one kind (OVERHAUL-1): Invite an agent lists hire invitations and Refer a recruit
 * lists prospect join links. The server filters AND counts by kind, so a tab's number is the
 * number of rows it opens. No kind lists both, as before.
 */
export function useInvitations(includeHistory: boolean, search: string, kind?: InviteLinkKind) {
  return useQuery({
    queryKey: ["invitations", includeHistory, search, kind ?? "all"],
    queryFn: async (): Promise<InvitationList> => {
      const { data, error } = await supabase.rpc("list_invitations" as never, {
        p_include_history: includeHistory,
        p_search: search.trim() || null,
        p_limit: 500,
        ...(kind ? { p_kind: kind } : {}),
      } as never);
      if (error) throw error;
      const raw = (data ?? {}) as unknown as InvitationList;
      return { counts: raw.counts, rows: raw.rows ?? [], limit: raw.limit };
    },
  });
}

export interface MyRecruitingLink {
  active: boolean;
  agent_id?: string;
  ref_slug?: string | null;
  link?: string;
}

/**
 * The viewer's own /r/<slug> link (my_recruiting_link(), auth.uid()-scoped). Same query key as
 * the Home card (MyReferralLinkCard), so both read one cached answer.
 */
export function useMyRecruitingLink(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["my-recruiting-link", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MyRecruitingLink> => {
      const { data, error } = await supabase.rpc("my_recruiting_link" as never);
      if (error) throw error;
      return (data ?? { active: false }) as unknown as MyRecruitingLink;
    },
  });
}

