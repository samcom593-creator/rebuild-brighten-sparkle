/**
 * Command Center "Manager Invites" card.
 *
 * §8 APEX OS redesign (2026-10-06). This card used to mint manager_signup_tokens
 * client-side with Math.random (not a cryptographic source), insert them under
 * a client write, and let anyone with the card delete rows outright — a second
 * invitation system beside invite_tokens that carried no upline, comp, expiry
 * state or audit trail (1 row ever). Manager invitations are now ordinary
 * personal invitations minted with target_role = hired_manager through
 * create_invitation, which only an admin may do (fn_invite_authorize), and the
 * role is granted on acceptance by trg_apply_invite_target_role. The old
 * manager_signup_tokens rows are left untouched as history; /signup?token=
 * still validates them.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";

const MANAGER_ROLES = ["hired_manager", "manager", "agency_owner"];

export function AdminManagerInvites() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Manager invitations</h3>
          <p className="text-xs text-muted-foreground">Personal one-time links that grant manager access on acceptance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/invite-links" className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
            All invitations
          </Link>
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invite manager
          </Button>
        </div>
      </div>

      <InvitationsTable roleFilter={MANAGER_ROLES} title="Manager invitations" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite a manager</DialogTitle>
            <DialogDescription>
              Choose their upline and approved comp. Manager access is granted only when they accept.
            </DialogDescription>
          </DialogHeader>
          {open && <InviteAgentForm defaultInviteAs="hired_manager" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
