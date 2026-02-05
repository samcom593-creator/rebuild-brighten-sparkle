import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Clock, AlertTriangle } from "lucide-react";

interface LeadExpiryCountdownProps {
  createdAt: string;
  contactedAt?: string;
}

export function LeadExpiryCountdown({ createdAt, contactedAt }: LeadExpiryCountdownProps) {
  const created = new Date(createdAt);
  const now = new Date();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  
  const elapsed = now.getTime() - created.getTime();
  const remaining = Math.max(0, twoWeeksMs - elapsed);
  const daysRemaining = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const progress = Math.min(100, (elapsed / twoWeeksMs) * 100);
  
  const isUrgent = daysRemaining <= 3;
  const isExpired = daysRemaining === 0;

  return (
    <div className="space-y-2 p-3 rounded-xl bg-muted/20 border border-border/30">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {isUrgent ? (
            <AlertTriangle className={cn("h-4 w-4", isExpired ? "text-red-500" : "text-amber-400")} />
          ) : (
            <Clock className="h-4 w-4 text-muted-foreground" />
          )}
          <span className={cn(
            "font-medium",
            isExpired && "text-red-400",
            isUrgent && !isExpired && "text-amber-400",
            !isUrgent && "text-muted-foreground"
          )}>
            {isExpired 
              ? "Lead Expired" 
              : `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`
            }
          </span>
        </div>
        {contactedAt && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
            Contacted
          </span>
        )}
      </div>
      <Progress 
        value={progress} 
        className={cn(
          "h-2",
          isExpired && "[&>div]:bg-red-500",
          isUrgent && !isExpired && "[&>div]:bg-amber-500",
          !isUrgent && "[&>div]:bg-primary"
        )} 
      />
      <p className="text-xs text-muted-foreground">
        2-week lead window • {Math.round(progress)}% elapsed
      </p>
    </div>
  );
}
