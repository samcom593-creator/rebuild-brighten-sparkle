import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DollarSign, Users, TrendingUp, AlertTriangle } from "lucide-react";

export type StatType = "totalAlp" | "activeAgents" | "producers" | "needsAttention";

interface AgentData {
  id: string;
  fullName: string;
  totalAlp: number;
  totalDeals: number;
  isDeactivated?: boolean;
  isInactive?: boolean;
}

interface StatCardPopupProps {
  type: StatType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentData[];
  timePeriod?: "week" | "month" | "day" | "custom";
}

const icons = {
  totalAlp: DollarSign,
  activeAgents: Users,
  producers: TrendingUp,
  needsAttention: AlertTriangle,
};

const titles = {
  totalAlp: "ALP Contributors",
  activeAgents: "Active Agents",
  producers: "Producers This Period",
  needsAttention: "Needs Attention",
};

const descriptions = {
  totalAlp: "Agents who contributed to this period's ALP",
  activeAgents: "All agents marked as active in the system",
  producers: "Agents who sold at least one deal",
  needsAttention: "Agents under threshold with low production",
};

export function StatCardPopup({
  type,
  open,
  onOpenChange,
  agents,
  timePeriod = "week",
}: StatCardPopupProps) {
  const Icon = icons[type];
  
  // Filter agents based on type
  const filteredAgents = agents.filter((agent) => {
    switch (type) {
      case "totalAlp":
        return agent.totalAlp > 0;
      case "activeAgents":
        return !agent.isDeactivated && !agent.isInactive;
      case "producers":
        return agent.totalDeals > 0 && !agent.isDeactivated && !agent.isInactive;
      case "needsAttention":
        const threshold = timePeriod === "month" ? 20000 : 5000;
        return !agent.isDeactivated && !agent.isInactive && agent.totalAlp < threshold;
      default:
        return true;
    }
  });

  // Sort appropriately
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    if (type === "needsAttention") {
      return a.totalAlp - b.totalAlp; // Lowest first
    }
    return b.totalAlp - a.totalAlp; // Highest first
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn(
              "h-5 w-5",
              type === "needsAttention" ? "text-destructive" : "text-primary"
            )} />
            {titles[type]}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{descriptions[type]}</p>
        </DialogHeader>
        
        <ScrollArea className="max-h-[400px] pr-4">
          {sortedAgents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No agents in this category</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedAgents.map((agent, index) => (
                <div
                  key={agent.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    type === "needsAttention" && agent.totalAlp === 0 && "border-destructive/30 bg-destructive/5",
                    index === 0 && type !== "needsAttention" && "bg-primary/5 border-primary/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                      type !== "needsAttention" && index === 0 && "bg-amber-500 text-black",
                      type !== "needsAttention" && index === 1 && "bg-gray-300 text-black",
                      type !== "needsAttention" && index === 2 && "bg-amber-700 text-white",
                      (type === "needsAttention" || index > 2) && "bg-muted text-muted-foreground"
                    )}>
                      {index + 1}
                    </div>
                    <span className="font-medium text-sm">{agent.fullName}</span>
                  </div>
                  <div className="text-right">
                    {type === "activeAgents" ? (
                      <Badge variant="secondary" className="text-xs">Active</Badge>
                    ) : (
                      <>
                        <p className={cn(
                          "font-bold",
                          type === "needsAttention" && agent.totalAlp === 0 && "text-destructive"
                        )}>
                          ${Math.round(agent.totalAlp).toLocaleString()}
                        </p>
                        {type === "producers" && (
                          <p className="text-xs text-muted-foreground">{agent.totalDeals} deals</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        
        <div className="pt-2 border-t text-center text-sm text-muted-foreground">
          {sortedAgents.length} agent{sortedAgents.length !== 1 ? "s" : ""}
        </div>
      </DialogContent>
    </Dialog>
  );
}
