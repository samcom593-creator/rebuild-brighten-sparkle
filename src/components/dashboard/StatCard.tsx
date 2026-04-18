import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "default" | "primary" | "success" | "warning";
  className?: string;
  /** Click handler — makes the whole card actionable */
  onClick?: () => void;
  /** OR an href — becomes a Link. Use one or the other, not both. */
  href?: string;
  /** Short helper text displayed below the value (e.g. "Click to view list") */
  hint?: string;
}

const variantStyles = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-emerald-400",
  warning: "text-amber-400",
};

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  variant = "default",
  className,
  onClick,
  href,
  hint,
}: StatCardProps) {
  const interactive = !!(onClick || href);

  const inner = (
    <GlassCard
      className={cn(
        "p-5 transition-all",
        interactive && "cursor-pointer hover:ring-2 hover:ring-primary/30 hover:glow-teal",
        !interactive && "hover:glow-teal",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className={cn("text-2xl font-bold", variantStyles[variant])}>
            {value}
          </p>
          {trend && (
            <div className={cn(
              "flex items-center gap-1 text-xs mt-1",
              trend.isPositive ? "text-emerald-400" : "text-red-400",
            )}>
              <span>{trend.isPositive ? "↑" : "↓"}</span>
              <span>{Math.abs(trend.value)}%</span>
              <span className="text-muted-foreground">vs last period</span>
            </div>
          )}
          {hint && (
            <p className="text-[10px] text-muted-foreground/70 mt-1">{hint}</p>
          )}
        </div>
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </GlassCard>
  );

  const wrapped = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      {inner}
    </motion.div>
  );

  if (href) {
    return <Link to={href} className="block">{wrapped}</Link>;
  }
  if (onClick) {
    return (
      <button onClick={onClick} className="block w-full text-left">
        {wrapped}
      </button>
    );
  }
  return wrapped;
}
