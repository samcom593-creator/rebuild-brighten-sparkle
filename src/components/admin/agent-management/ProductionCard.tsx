import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Phone, Mail, MessageSquare, ListTodo, MoreVertical,
} from "lucide-react";

export interface AgentProdCard {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  todayALP: number;
  weekALP: number;
  lastLogged: string | null;
  streak: number;
  status: "green" | "yellow" | "red";
}

const statusBorder = (s: AgentProdCard["status"]) => {
  if (s === "green") return "border-l-emerald-400";
  if (s === "yellow") return "border-l-yellow-400";
  return "border-l-red-400";
};

interface Props {
  agent: AgentProdCard;
  onNudge: (a: AgentProdCard) => void;
  onCreateFollowup: (a: AgentProdCard) => void;
}

export function ProductionCard({ agent, onNudge, onCreateFollowup }: Props) {
  return (
    <GlassCard className={`p-4 border-l-4 ${statusBorder(agent.status)} group`}>
      <div className="flex items-start justify-between mb-2">
        <div className="font-semibold text-sm truncate flex-1">{agent.name}</div>
        {agent.streak > 0 && (
          <Badge variant="outline" className="text-[10px] shrink-0">🔥 {agent.streak}d</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Today</span>
          <div className="font-bold text-primary">${agent.todayALP.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-muted-foreground">This Week</span>
          <div className="font-bold">${agent.weekALP.toLocaleString()}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">
          {agent.lastLogged
            ? `Last: ${new Date(agent.lastLogged).toLocaleDateString()}`
            : "Never logged"}
        </span>

        <div className="flex items-center gap-0.5">
          {agent.phone && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Call">
              <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /></a>
            </Button>
          )}
          {agent.phone && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Text">
              <a href={`sms:${agent.phone}`}><MessageSquare className="h-3 w-3" /></a>
            </Button>
          )}
          {agent.email && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Email">
              <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /></a>
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-6 w-6 p-0"
            title="Nudge (creates high-priority task)"
            onClick={() => onNudge(agent)}
          >
            <ListTodo className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onCreateFollowup(agent)}>
                <ListTodo className="h-3.5 w-3.5 mr-2" /> Create Follow-up Task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNudge(agent)}>
                <ListTodo className="h-3.5 w-3.5 mr-2" /> Nudge (urgent task today)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {agent.phone && (
                <DropdownMenuItem asChild>
                  <a href={`tel:${agent.phone}`}>
                    <Phone className="h-3.5 w-3.5 mr-2" /> Call {agent.phone}
                  </a>
                </DropdownMenuItem>
              )}
              {agent.email && (
                <DropdownMenuItem asChild>
                  <a href={`mailto:${agent.email}`}>
                    <Mail className="h-3.5 w-3.5 mr-2" /> Email
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </GlassCard>
  );
}
