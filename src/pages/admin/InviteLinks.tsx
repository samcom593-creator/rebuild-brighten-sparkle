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
import { Link2, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";

export default function InviteLinksAdmin() {
  usePageTitle("Invite Agent");
  const { isAdmin } = useAuth();

  return (
    <div className="page-enter mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Contracting · Invite an agent"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Invite Agent"
        subtitle="One personal link per recruit, carrying the upline and the approved comp they accept."
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3" data-testid="license-routing">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">License status is always required.</span>{" "}
              Lock it here, or let the recruit choose Licensed or Unlicensed on the invite. Licensed starts contracting on acceptance; unlicensed starts the licensing roadmap.
            </p>
          </div>
          <InviteAgentForm />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Invitations</h2>
          {isAdmin && (
            <Link to="/dashboard/recruiting-links" className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              Public recruiting links
            </Link>
          )}
        </div>
        <InvitationsTable />
      </div>
    </div>
  );
}
