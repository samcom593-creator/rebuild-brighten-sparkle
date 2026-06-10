import { motion } from "framer-motion";
import { 
  TrendingUp, 
  Target, 
  BarChart3, 
  Award,
  Zap,
  ChevronRight
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PerformanceDashboardSectionProps {
  onNavigateToStats?: () => void;
  onNavigateToGoals?: () => void;
  onNavigateToHistory?: () => void;
}

interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  color: "primary" | "amber" | "emerald" | "violet";
  onClick?: () => void;
  delay?: number;
}

function FeatureCard({ icon: Icon, title, description, color, onClick, delay = 0 }: FeatureCardProps) {
  const colorClasses = {
    primary: "bg-primary/[0.06] border-primary/30 text-primary",
    amber: "bg-amber-500/[0.06] border-amber-500/30 text-amber-500",
    emerald: "bg-emerald-500/[0.06] border-emerald-500/30 text-emerald-500",
    violet: "bg-violet-500/[0.06] border-violet-500/30 text-primary",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <button
        onClick={onClick}
        className={cn(
          "w-full text-left p-4 rounded-md border transition-all",
          "hover:shadow-sm hover:shadow-current/10 focus:outline-none focus:ring-2 focus:ring-primary/50",
          colorClasses[color]
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg bg-background/60 ",
              colorClasses[color]
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground">{title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
        </div>
      </button>
    </motion.div>
  );
}

export function PerformanceDashboardSection({ 
  onNavigateToStats, 
  onNavigateToGoals, 
  onNavigateToHistory 
}: PerformanceDashboardSectionProps) {
  const scrollToElement = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-8 relative overflow-hidden">
        {/* Powered by Apex - subtle branding */}
        <span className="absolute top-3 right-4 text-[10px] text-muted-foreground/40 font-medium tracking-wider uppercase">
          Powered by Apex
        </span>
        
        <div className="relative">
          {/* Header - Larger */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white dark:bg-slate-900 text-white shadow-sm shadow-primary/25">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Performance Dashboard</h3>
              <p className="text-sm text-muted-foreground">Track your growth and hit your goals</p>
            </div>
          </div>

          {/* Feature Cards Grid - Larger */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard
              icon={BarChart3}
              title="Personal Stats"
              description="View your benchmarks vs team averages"
              color="primary"
              onClick={() => scrollToElement('personal-stats')}
              delay={0.1}
            />
            <FeatureCard
              icon={Target}
              title="Income Goals"
              description="Calculate your path to financial goals"
              color="amber"
              onClick={() => scrollToElement('income-goals')}
              delay={0.15}
            />
            <FeatureCard
              icon={TrendingUp}
              title="Production History"
              description="Track your 4-week performance trend"
              color="emerald"
              onClick={() => scrollToElement('production-history')}
              delay={0.2}
            />
            <FeatureCard
              icon={Award}
              title="Team Goals"
              description="See how the team is crushing it"
              color="violet"
              onClick={() => scrollToElement('team-goals')}
              delay={0.25}
            />
          </div>

          {/* Motivational Tip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 p-4 rounded-md bg-primary/5 border border-primary/10 text-center"
          >
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-primary">Pro Tip:</span> Log your numbers daily to unlock personalized income projections and coaching insights
            </p>
          </motion.div>
        </div>
      </GlassCard>
    </motion.section>
  );
}
