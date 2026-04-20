import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Phone, Mail, MessageSquare, CheckCircle2,
} from "lucide-react";

export interface AlertItem {
  type: "overdue_task" | "no_production";
  label: string;
  agentId: string;
  agentName: string;
  agentPhone: string | null;
  agentEmail: string | null;
  taskId?: string;
  color: string;
}

interface Props {
  alerts: AlertItem[];
  onMarkComplete: (taskId: string, agentName: string) => void;
}

export function AlertsList({ alerts, onMarkComplete }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No alerts right now — all clear! ✅
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => (
        <GlassCard key={i} className="p-3 flex items-center gap-3 group">
          <AlertTriangle className={`h-4 w-4 ${alert.color} shrink-0`} />
          <span className="text-sm flex-1 truncate">{alert.label}</span>
          <div className="flex items-center gap-0.5 shrink-0">
            {alert.agentPhone && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Call">
                <a href={`tel:${alert.agentPhone}`}><Phone className="h-3.5 w-3.5" /></a>
              </Button>
            )}
            {alert.agentPhone && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Text">
                <a href={`sms:${alert.agentPhone}`}><MessageSquare className="h-3.5 w-3.5" /></a>
              </Button>
            )}
            {alert.agentEmail && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Email">
                <a href={`mailto:${alert.agentEmail}`}><Mail className="h-3.5 w-3.5" /></a>
              </Button>
            )}
            {alert.type === "overdue_task" && alert.taskId && (
              <Button
                size="sm" variant="ghost"
                className="h-7 px-2 text-xs text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => onMarkComplete(alert.taskId!, alert.agentName)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Done
              </Button>
            )}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
