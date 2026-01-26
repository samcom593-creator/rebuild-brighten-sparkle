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
    primary: "from-primary/20 via-primary/10 to-transparent border-primary/30 text-primary",
    amber: "from-amber-500/20 via-amber-500/10 to-transparent border-amber-500/30 text-amber-500",
    emerald: "from-emerald-500/20 via-emerald-500/10 to-transparent border-emerald-500/30 text-emerald-500",
    violet: "from-violet-500/20 via-violet-500/10 to-transparent border-violet-500/30 text-violet-500",
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
          "w-full text-left p-4 rounded-xl border bg-gradient-to-br transition-all",
          "hover:shadow-lg hover:shadow-current/10 focus:outline-none focus:ring-2 focus:ring-primary/50",
          colorClasses[color]
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg bg-background/60 backdrop-blur-sm",
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
      transition={{ delay: 0.3 }}
    >
      <GlassCard className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-lg shadow-primary/25">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Performance Dashboard</h3>
            <p className="text-xs text-muted-foreground">Track your growth and hit your goals</p>
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid gap-3 sm:grid-cols-2">
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
          className="mt-5 p-3 rounded-lg bg-primary/5 border border-primary/10 text-center"
        >
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-primary">Pro Tip:</span> Log your numbers daily to unlock personalized income projections and coaching insights
          </p>
        </motion.div>
      </GlassCard>
    </motion.section>
  );
}
