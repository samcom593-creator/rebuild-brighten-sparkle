/**
 * Command Center "Invite Team" — mints a personal invitation.
 *
 * §8 APEX OS redesign (2026-10-06). This dialog used to create the account
 * itself: an account-creation edge function (no auth check, fixed password) then an
 * UNCONDITIONAL client-side agents.insert, even when the function reported the
 * person already existed — a duplicate-person writer with no manager_id, no
 * comp, no expiry and no record of the invitation. A manager's run also died
 * half-way at the admin-only generate-magic-link, after the rows were written.
 *
 * It now mints the same opaque, single-use invitation /admin/invite-links does
 * (create_invitation → /hire/:token → consume-invite-token), so identity
 * dedupe, upline placement, approved comp and contracting all happen in one
 * server-validated acceptance. The empty contracting_links feature (0 rows
 * ever) is gone with it.
 */
import { UserPlus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";

interface InviteTeamModalProps {
  open: boolean;
  onClose: () => void;
}

export function InviteTeamModal({ open, onClose }: InviteTeamModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Invite to your team
          </DialogTitle>
          <DialogDescription>
            Creates a personal one-time link with the upline and approved comp. Nothing is sent until you share it.
          </DialogDescription>
        </DialogHeader>
        {open && <InviteAgentForm />}
      </DialogContent>
    </Dialog>
  );
}
