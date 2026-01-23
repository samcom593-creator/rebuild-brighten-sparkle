import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, RefreshCw, Sparkles, Target, Clock, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AgentStats {
  totalLeads: number;
  contacted: number;
  qualified: number;
  closed: number;
  closeRate: number;
  avgWaitTime: number;
  staleLeads: number;
  teamAvgCloseRate: number;
}

interface AICoachingPanelProps {
  stats: AgentStats;
  className?: string;
}

export function AICoachingPanel({ stats, className }: AICoachingPanelProps) {
  const [coaching, setCoaching] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const getCoaching = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          type: 'coaching',
          agentStats: stats,
        },
      });

      if (error) throw error;
      setCoaching(data.content);
    } catch (error) {
      console.error('Coaching error:', error);
      toast({
        title: "Error",
        description: "Failed to get coaching tips. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatCoaching = (text: string) => {
    // Split by numbered items or bullet points
    const lines = text.split(/\n/).filter(line => line.trim());
    return lines.map((line, index) => {
      const isHeader = line.match(/^\d+\.|^-|^\*/);
      return (
        <motion.p
          key={index}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className={cn(
            "text-sm leading-relaxed",
            isHeader ? "font-medium text-foreground mt-3 first:mt-0" : "text-muted-foreground ml-4"
          )}
        >
          {line}
        </motion.p>
      );
    });
  };

  return (
    <GlassCard className={cn("p-6", className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Performance Coach
        </h3>
        <Button
          onClick={getCoaching}
          disabled={isLoading}
          size="sm"
          className="gap-2"
        >
          {isLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {coaching ? 'Refresh' : 'Get Coaching'}
        </Button>
      </div>

      {/* Quick Stats Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Target className="h-4 w-4 mx-auto mb-1 text-primary" />
          <p className="text-lg font-bold">{stats.closeRate.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">Close Rate</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Clock className="h-4 w-4 mx-auto mb-1 text-amber-500" />
          <p className="text-lg font-bold">{stats.avgWaitTime.toFixed(0)}h</p>
          <p className="text-xs text-muted-foreground">Avg Response</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <TrendingUp className="h-4 w-4 mx-auto mb-1 text-emerald-500" />
          <p className="text-lg font-bold">{stats.staleLeads}</p>
          <p className="text-xs text-muted-foreground">Stale Leads</p>
        </div>
      </div>

      {/* Coaching Content */}
      {coaching ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-4 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20"
        >
          <div className="space-y-1">
            {formatCoaching(coaching)}
          </div>
        </motion.div>
      ) : (
        <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/30 text-center">
          <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Click "Get Coaching" to receive personalized tips based on your performance metrics.
          </p>
        </div>
      )}
    </GlassCard>
  );
}
