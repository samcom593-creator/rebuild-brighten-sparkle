import { Eye, ShieldCheck, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type RolePreview, useRolePreview } from "@/hooks/useRolePreview";
import { cn } from "@/lib/utils";

const roleOptions: Array<{ role: RolePreview; label: string; icon: React.ElementType }> = [
  { role: "agent", label: "Agent View", icon: User },
  { role: "manager", label: "Manager View", icon: Users },
  { role: "admin", label: "Admin View", icon: ShieldCheck },
];

export function RolePreviewBubbles() {
  const { canPreviewRoles, effectiveRole, setPreviewRole } = useRolePreview();

  if (!canPreviewRoles) return null;

  return (
    <div className="fixed right-4 top-4 z-30 hidden items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1 shadow-sm backdrop-blur lg:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Eye className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Preview role-specific dashboard routing</TooltipContent>
      </Tooltip>
      {roleOptions.map((option) => {
        const Icon = option.icon;
        const active = effectiveRole === option.role;
        return (
          <Button
            key={option.role}
            type="button"
            size="sm"
            variant={active ? "default" : "ghost"}
            className={cn("h-8 rounded-full px-3 text-xs", active && "shadow-none")}
            onClick={() => setPreviewRole(option.role === "admin" ? null : option.role)}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
