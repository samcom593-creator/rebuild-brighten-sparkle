import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Calendar, DollarSign } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedNumber } from "./AnimatedNumber";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, subDays, parseISO } from "date-fns";

interface ProductionHistoryChartProps {
  agentId: string;
}

interface DayData {
  date: string;
  displayDate: string;
  alp: number;
  deals: number;
  closingRate: number;
}

export function ProductionHistoryChart({ agentId }: ProductionHistoryChartProps) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalAlp: 0,
    totalDeals: 0,
    avgDaily: 0,
    bestDay: { date: "", amount: 0 },
    trend: 0,
  });

  useEffect(() => {
    if (agentId) {
      fetchHistory();
    }
  }, [agentId]);

  const fetchHistory = async () => {
    try {
      const today = new Date();
      const fourWeeksAgo = subDays(today, 28);
      
      const { data: production } = await supabase
        .from("daily_production")
        .select("production_date, aop, deals_closed, closing_rate")
        .eq("agent_id", agentId)
        .gte("production_date", fourWeeksAgo.toISOString().split("T")[0])
        .order("production_date", { ascending: true });

      if (production) {
        // Fill in missing days with zeros
        const filledData: DayData[] = [];
        for (let i = 27; i >= 0; i--) {
          const date = subDays(today, i);
          const dateStr = date.toISOString().split("T")[0];
          const existing = production.find((p) => p.production_date === dateStr);
          
          filledData.push({
            date: dateStr,
            displayDate: format(date, "MMM d"),
            alp: Number(existing?.aop || 0),
            deals: Number(existing?.deals_closed || 0),
            closingRate: Number(existing?.closing_rate || 0),
          });
        }

        setData(filledData);

        // Calculate summary
        const withProduction = filledData.filter((d) => d.alp > 0);
        const totalAlp = filledData.reduce((sum, d) => sum + d.alp, 0);
        const totalDeals = filledData.reduce((sum, d) => sum + d.deals, 0);
        const avgDaily = withProduction.length > 0 ? totalAlp / withProduction.length : 0;
        
        // Find best day
        const best = filledData.reduce((max, d) => (d.alp > max.alp ? d : max), filledData[0]);
        
        // Calculate trend (last 2 weeks vs previous 2 weeks)
        const lastTwoWeeks = filledData.slice(14).reduce((sum, d) => sum + d.alp, 0);
        const prevTwoWeeks = filledData.slice(0, 14).reduce((sum, d) => sum + d.alp, 0);
        const trend = prevTwoWeeks > 0 ? ((lastTwoWeeks - prevTwoWeeks) / prevTwoWeeks) * 100 : 0;

        setSummary({
          totalAlp,
          totalDeals,
          avgDaily,
          bestDay: { date: best.displayDate, amount: best.alp },
          trend,
        });
      }
    } catch (error) {
      console.error("Error fetching history:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-48 bg-muted/50 rounded" />
        </div>
      </GlassCard>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm mb-1">{label}</p>
          <p className="text-primary font-bold">
            ${payload[0]?.value?.toLocaleString() || 0}
          </p>
          <p className="text-xs text-muted-foreground">
            {payload[1]?.value || 0} deals
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold gradient-text flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            4-Week Production History
          </h3>
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            summary.trend >= 0 
              ? "bg-emerald-500/20 text-emerald-500" 
              : "bg-red-500/20 text-red-500"
          }`}>
            {summary.trend >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(summary.trend).toFixed(0)}% trend
          </div>
        </div>

        {/* Chart */}
        <div className="h-48 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="alpGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                dataKey="displayDate" 
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={6}
              />
              <YAxis 
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="alp"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#alpGradient)"
                animationDuration={1500}
              />
              <Area
                type="monotone"
                dataKey="deals"
                stroke="hsl(var(--chart-2))"
                strokeWidth={1}
                fill="none"
                strokeDasharray="4 4"
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <AnimatedNumber
              value={summary.totalAlp}
              formatAsCurrency
              className="text-lg font-bold block"
            />
            <span className="text-[10px] text-muted-foreground">4-Week Total</span>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <AnimatedNumber
              value={summary.totalDeals}
              className="text-lg font-bold block"
            />
            <span className="text-[10px] text-muted-foreground">Total Deals</span>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <AnimatedNumber
              value={summary.avgDaily}
              formatAsCurrency
              className="text-lg font-bold block"
            />
            <span className="text-[10px] text-muted-foreground">Avg/Day</span>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/10 border border-primary/30">
            <AnimatedNumber
              value={summary.bestDay.amount}
              formatAsCurrency
              className="text-lg font-bold block text-primary"
            />
            <span className="text-[10px] text-muted-foreground">Best Day</span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
