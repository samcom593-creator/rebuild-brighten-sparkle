import { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { cn } from "@/lib/utils";

type PeriodType = "day" | "week" | "month";

interface GrowthData {
  label: string;
  leads: number;
  closed: number;
}

interface GrowthChartProps {
  dailyData: GrowthData[];
  weeklyData: GrowthData[];
  monthlyData: GrowthData[];
  currentPeriodTotal: number;
  previousPeriodTotal: number;
  className?: string;
}

export function GrowthChart({ 
  dailyData,
  weeklyData,
  monthlyData,
  currentPeriodTotal,
  previousPeriodTotal,
  className 
}: GrowthChartProps) {
  const [period, setPeriod] = useState<PeriodType>("week");

  const getData = () => {
    switch (period) {
      case "day": return dailyData;
      case "week": return weeklyData;
      case "month": return monthlyData;
    }
  };

  const growthPercent = previousPeriodTotal > 0 
    ? ((currentPeriodTotal - previousPeriodTotal) / previousPeriodTotal) * 100 
    : 0;
  const isPositive = growthPercent >= 0;

  return (
    <GlassCard className={cn("p-6", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Growth Analytics
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Track your leads and closings over time
          </p>
        </div>
        
        <div className="flex gap-2">
          {(["day", "week", "month"] as PeriodType[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p)}
              className="capitalize"
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      <div className="h-64 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={getData()}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 20%)" />
            <XAxis 
              dataKey="label" 
              stroke="hsl(220 15% 60%)"
              fontSize={12}
            />
            <YAxis 
              stroke="hsl(220 15% 60%)"
              fontSize={12}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: "hsl(222 47% 10%)",
                border: "1px solid hsl(222 30% 20%)",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "hsl(180 100% 97%)" }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="leads" 
              stroke="hsl(168 84% 42%)" 
              strokeWidth={2}
              dot={{ fill: "hsl(168 84% 42%)", strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              name="Leads"
            />
            <Line 
              type="monotone" 
              dataKey="closed" 
              stroke="hsl(160 84% 39%)" 
              strokeWidth={2}
              dot={{ fill: "hsl(160 84% 39%)", strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              name="Closed"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <motion.div 
        className="flex items-center justify-between p-4 rounded-lg bg-muted/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div>
          <p className="text-sm text-muted-foreground">Current Period</p>
          <p className="text-2xl font-bold">{currentPeriodTotal} leads</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">vs Previous Period</p>
          <div className={cn(
            "flex items-center gap-1 text-lg font-semibold",
            isPositive ? "text-emerald-400" : "text-red-400"
          )}>
            {isPositive ? (
              <TrendingUp className="h-5 w-5" />
            ) : (
              <TrendingDown className="h-5 w-5" />
            )}
            <span>{isPositive ? "+" : ""}{growthPercent.toFixed(1)}%</span>
          </div>
        </div>
      </motion.div>
    </GlassCard>
  );
}
