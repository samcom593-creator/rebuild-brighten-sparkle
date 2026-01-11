import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { cn } from "@/lib/utils";

interface PieData {
  name: string;
  value: number;
  color: string;
}

interface AnalyticsPieChartProps {
  title: string;
  icon?: React.ReactNode;
  data: PieData[];
  className?: string;
}

export function AnalyticsPieChart({ title, icon, data, className }: AnalyticsPieChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <GlassCard className={cn("p-6", className)}>
      <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
        {icon}
        {title}
      </h3>
      
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{
                backgroundColor: "hsl(222 47% 10%)",
                border: "1px solid hsl(222 30% 20%)",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [
                `${value} (${((value / total) * 100).toFixed(1)}%)`,
                ""
              ]}
            />
            <Legend 
              verticalAlign="bottom"
              formatter={(value) => (
                <span style={{ color: "hsl(220 15% 70%)" }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2 mt-4">
        {data.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
            <span className="font-medium">
              {item.value} ({total > 0 ? ((item.value / total) * 100).toFixed(0) : 0}%)
            </span>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}
