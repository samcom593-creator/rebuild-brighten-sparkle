import { Moon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FOLLOWUP_TIMING } from "@/lib/apexConfig";

interface DormantBadgeProps {
  lastContactedAt: string | null;
  contactedAt: string | null;
  createdAt: string;
}

export function DormantBadge({ lastContactedAt, contactedAt, createdAt }: DormantBadgeProps) {
  const lastActivity = lastContactedAt || contactedAt || createdAt;
  const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < FOLLOWUP_TIMING.dormantDays) return null;

  return (
    <Badge className="text-[9px] border px-1.5 py-0 bg-slate-500/20 text-slate-400 border-slate-500/30 gap-0.5">
      <Moon className="h-2 w-2" />
      Dormant
    </Badge>
  );
}
