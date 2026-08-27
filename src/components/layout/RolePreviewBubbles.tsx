import { Briefcase, Building2, Check, Eye, Headset, ShieldCheck, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type RolePreview, useRolePreview } from "@/hooks/useRolePreview";
import { cn } from "@/lib/utils";

const roleOptions: Array<{ role: RolePreview; label: string; icon: React.ElementType }> = [
  { role: "agent", label: "Agent View", icon: User },
  { role: "manager", label: "Manager View", icon: Users },
  { role: "agency_owner", label: "Agency Owner View", icon: Building2 },
  { role: "recruiter", label: "Recruiter View", icon: Briefcase },
  { role: "va", label: "VA View", icon: Headset },
  { role: "admin", label: "Admin View", icon: ShieldCheck },
];

// Was a draggable fixed-position pill strip anchored top-right — it sat exactly
// over every page header's action buttons (Refresh, Invite an agent, Copy
// Quote, Manage content were all half-hidden on 7 routes in the 2026-08-20 UI
// audit). Agent Cloud has no floating chrome, so the switcher now lives in the
// TopBar as a compact dropdown: same capability, zero overlap, on every page.
export function RolePreviewMenu() {
  const { canPreviewRoles, effectiveRole, setPreviewRole } = useRolePreview();
  if (!canPreviewRoles) return null;
  const active = roleOptions.find((o) => o.role === effectiveRole);
  const ActiveIcon = active?.icon ?? Eye;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            // 2026-08-23 light/dark wave: was text-[#9A9A9A] with
            // hover:bg-white/[0.04] hover:text-white — a dark-only hover. On
            // light the hover painted white text on a cream page, so the
            // control vanished at the moment the pointer reached it.
            "h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
            effectiveRole !== "admin" && "text-primary hover:text-primary",
          )}
          aria-label="Preview as role"
        >
          <ActiveIcon className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{active?.label ?? "View as"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Preview as
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {roleOptions.map(({ role, label, icon: Icon }) => (
          <DropdownMenuItem key={role} onClick={() => setPreviewRole(role)} className="gap-2 text-sm">
            <Icon className="h-3.5 w-3.5" />
            {label}
            {effectiveRole === role && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Back-compat named export: the old floating strip is retired; mounting it is
// now a no-op so any stale import renders nothing instead of floating chrome.
export function RolePreviewBubbles() {
  return null;
}
