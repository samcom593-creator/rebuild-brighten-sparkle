import { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Award, Clock, Users } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";

const earningsData = {
  fullTime: {
    label: "Full-Time",
    description: "30-60 hours/week",
    monthly: 20833,
    yearly: 250000,
    policiesPerMonth: 30,
    commissionRate: "70%-145%",
  },
  topProducer: {
    label: "Top Producer",
    description: "40+ hours/week",
    monthly: 42000,
    yearly: 504000,
    policiesPerMonth: 35,
    commissionRate: "90%-145%",
  },
};

const milestones = [
  { icon: Clock, label: "First Sale", value: "First Day", description: "Average time to first close" },
  { icon: TrendingUp, label: "Break Even", value: "Immediate", description: "Time to profitability" },
  { icon: Award, label: "Six Figures", value: "4-6 months", description: "To reach $100K+ pace" },
  { icon: Users, label: "Build Team", value: "Year One", description: "Earn manager overrides" },
];

export function EarningsSection() {
  const [selected, setSelected] = useState<keyof typeof earningsData>("fullTime");
  const data = earningsData[selected];

  return (
    <section id="earnings" className="py-24 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.08)_0%,transparent_60%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Earnings Potential"
          title="Your Income, Your Choice"
          subtitle="See what's possible at APEX. Your income is determined by your effort and commitment."
        />

        {/* Earnings Toggle */}
        <div className="flex justify-center mt-12 mb-8">
          <div className="inline-flex rounded-lg glass p-1">
            {Object.entries(earningsData).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelected(key as keyof typeof earningsData)}
                className={`px-6 py-3 rounded-lg text-sm font-medium transition-all duration-300 ${
                  selected === key
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Earnings Card */}
        <motion.div
          key={selected}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-4xl mx-auto"
        >
          <GlassCard className="p-8 md:p-12 glow-teal">
            <div className="text-center mb-8">
              <p className="text-muted-foreground mb-2">{data.description}</p>
              <div className="text-6xl md:text-8xl font-bold gradient-text text-glow mb-2">
                $<AnimatedCounter value={data.yearly} />
              </div>
              <p className="text-xl text-muted-foreground">per year</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-border pt-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">
                  $<AnimatedCounter value={data.monthly} />
                </div>
                <p className="text-sm text-muted-foreground">Monthly Income</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">
                  <AnimatedCounter value={data.policiesPerMonth} />
                </div>
                <p className="text-sm text-muted-foreground">Policies/Month</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">
                  {data.commissionRate}
                </div>
                <p className="text-sm text-muted-foreground">Commission Rate</p>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Milestones */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 max-w-4xl mx-auto">
          {milestones.map((milestone, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              <GlassCard className="p-4 text-center h-full" hoverEffect>
                <milestone.icon className="h-6 w-6 text-primary mx-auto mb-2" />
                <div className="text-lg font-bold text-primary">{milestone.value}</div>
                <div className="text-sm font-medium">{milestone.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{milestone.description}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
