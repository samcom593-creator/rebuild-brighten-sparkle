/**
 * /admin/invite-links — Invite an agent: your own link, or a personal invitation with offered terms.
 *
 * OVERHAUL-1 (2026-10-29), Sam: "Give them an option: either put their first name, last name,
 * email, NPN, phone number... Or an option, just click attach a link, and they just tap it."
 *   - Top: your own permanent /r/<slug> link, Copy and Share, one tap (MyLinkCard). Everyone who
 *     applies through it is credited to you and placed under you (MP-342).
 *   - Make a link: Quick link or With details, Licensed or Not licensed yet (required),
 *     Permanent or Temporary, then Copy / Share / Text / Email (InviteAgentForm, kind hire).
 *   - Your invitations: hire invitations only; the server filters and counts by kind.
 *
 * THE CHAIN, AND WHAT PROVES EACH LINK
 *
 *   Create      → create_invitation(...)  [SECURITY DEFINER; fn_invite_authorize
 *                 decides who may invite whom, into which role, under which
 *                 upline, at which approved comp + carrier exceptions;
 *                 p_permanent stores expires_at 'infinity']
 *   Open link   → /hire/:token → get_invite_token_prefill(p_token) as anon; the
 *                 recipient sees ONLY their own offer (comp, exceptions, upline,
 *                 agency), never the inviter's level or anyone else's comp
 *   Accept      → consume-invite-token → invitation_claim (row lock + lease,
 *                 expiry / revocation / supersession / recipient email / single
 *                 use) → agent row → invitation_apply_terms (offered comp onto
 *                 agents.comp_percentage) → contracting intake →
 *                 invitation_complete (single-use stamp + accepted-terms snapshot)
 *   Role        → trg_apply_invite_target_role grants the app_role the
 *                 invitation was minted for once used_by_agent_id lands
 *
 * Status is derived on the server (fn_invitation_status: pending / accepted /
 * expired / revoked / superseded). Terminal invitations leave the active list
 * and stay searchable under History. Copy, Share, Text and Email are recorded as
 * shares, never as deliveries — nothing on this page sends a message.
 *
 * Public recruiting links for every manager (/r/<slug>) live on
 * /dashboard/recruiting-links and are never expired by anything here.
 */
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";
import { MyLinkCard } from "@/components/invitations/MyLinkCard";

export default function InviteLinksAdmin() {
  usePageTitle("Invite Agent");
  const { isAdmin } = useAuth();

  // One plain title, a subtitle that fits a 390px line whole, and the page's one gold button is
  // the form's Make link (then the made link's Copy). The header bubble is royal, the paperwork
  // tone, because an invitation is the first form of someone's contracting.
  return (
    <div className="page-enter mx-auto w-full max-w-5xl space-y-6 pb-24">
      <PageHeader
        title="Invite an agent"
        subtitle="Send your link, or make one for one person."
        icon={<UserPlus />}
        tone="royal"
      />

      <MyLinkCard blurb="Anyone who applies through it is credited to you and joins your team." />

      {/* The license rule is said once, as the hint of the License step (council findings 11 and 27). */}
      <InviteAgentForm framed licenseHint="License status is always required. Pick one." />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Your invitations</h2>
          {isAdmin && (
            <Link
              to="/dashboard/recruiting-links"
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              Links for every manager
            </Link>
          )}
        </div>
        <InvitationsTable kind="hire" title="Your invitations" />
      </div>
    </div>
  );
}
