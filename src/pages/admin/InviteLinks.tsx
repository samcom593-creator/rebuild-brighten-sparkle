/**
 * /admin/invite-links — Invite Agent: personal invitations with offered terms.
 *
 * THE CHAIN, AND WHAT PROVES EACH LINK
 *
 *   Create      → create_invitation(...)  [SECURITY DEFINER; fn_invite_authorize
 *                 decides who may invite whom, into which role, under which
 *                 upline, at which approved comp + carrier exceptions]
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
 * and stay searchable under History. Copy / Email draft are recorded as shares,
 * never as deliveries — nothing on this page sends an email.
 *
 * Public recruiting links (/r/<slug>) live on /dashboard/recruiting-links and
 * are never expired by anything here.
 */
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/ui/page-header";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";

export default function InviteLinksAdmin() {
  usePageTitle("Invite Agent");
  const { isAdmin } = useAuth();

  // Grow redesign (2026-10-28): one plain title, the form in four numbered steps, and the
  // contracting fields copy-ready on every invitation. The license rule is said once, in
  // the form's License step, instead of in a separate callout above it.
  return (
    <div className="page-enter mx-auto w-full max-w-5xl space-y-8 pb-24">
      <PageHeader
        title="Invite an agent"
        subtitle="Fill in what you know, create the link, and send it. Contracting starts when they accept."
      />

      <section aria-label="New invitation" className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-8">
        <p className="text-sm text-muted-foreground" data-testid="license-routing">
          <span className="font-medium text-foreground">License status is always required.</span>{" "}
          Set it in step 2, or let them choose on the invite.
        </p>
        <InviteAgentForm />
      </section>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Your invitations</h2>
          {isAdmin && (
            <Link to="/dashboard/recruiting-links" className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              Public recruiting links
            </Link>
          )}
        </div>
        <InvitationsTable />
      </div>
    </div>
  );
}
