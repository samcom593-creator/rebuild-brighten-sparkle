/**
 * Data access for personal invitations. Every call goes through a SECURITY
 * DEFINER RPC from 20261006140000_invitation_lifecycle.sql; the raw
 * invite_tokens table is never read or written from the client.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { InvitationStatus } from "@/lib/invitationState";

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
  expires_at: string;
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

export async function shareInvitation(id: string, channel: "copy" | "email_draft") {
  const { data, error } = await supabase.rpc("record_invitation_share" as never, {
    p_id: id,
    p_channel: channel,
  } as never);
  if (error) throw error;
  return data as unknown as { ok: boolean; status: string; path?: string; recipient_email?: string | null };
}

export function useInvitations(includeHistory: boolean, search: string) {
  return useQuery({
    queryKey: ["invitations", includeHistory, search],
    queryFn: async (): Promise<InvitationList> => {
      const { data, error } = await supabase.rpc("list_invitations" as never, {
        p_include_history: includeHistory,
        p_search: search.trim() || null,
        p_limit: 500,
      } as never);
      if (error) throw error;
      const raw = (data ?? {}) as unknown as InvitationList;
      return { counts: raw.counts, rows: raw.rows ?? [], limit: raw.limit };
    },
  });
}

