import { motion } from "framer-motion";
import { 
  DollarSign, 
  GraduationCap, 
  Calendar, 
  Target, 
  Users, 
  Trophy,
  Zap,
  HeartHandshake
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlassCard } from "@/components/ui/glass-card";

const benefits = [
  {
    icon: DollarSign,
    title: "Industry-Leading Commissions",
    description: "Earn 140-160% commission rates with bonuses up to $25K per month. Our agents consistently out-earn the competition.",
  },
  {
    icon: Target,
    title: "Exclusive Lead Program",
    description: "Receive 50-100 warm, exclusive leads weekly. No cold calling—only pre-qualified prospects ready to buy.",
  },
  {
    icon: GraduationCap,
    title: "World-Class Training",
    description: "Access our proven sales system, scripts, and mentorship. New agents close their first deal within 2 weeks on average.",
  },
  {
    icon: Calendar,
    title: "Flexible Schedule",
    description: "Work from anywhere, set your own hours. Build your business around your life, not the other way around.",
  },
  {
    icon: Users,
    title: "Team Culture & Support",
    description: "Join a community of top performers. Weekly masterminds, team calls, and 24/7 support when you need it.",
  },
  {
    icon: Trophy,
    title: "Career Advancement",
    description: "Clear path to management. Build your own team and earn overrides. Many managers earn $300K+ annually.",
  },
  {
    icon: Zap,
    title: "Fast-Start Bonuses",
    description: "Earn up to $10,000 in bonuses your first 90 days. We invest in your success from day one.",
  },
  {
    icon: HeartHandshake,
    title: "Meaningful Work",
    description: "Protect families and build generational wealth for your clients. This isn't just a job—it's a legacy.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 },
  },
};

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-24 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(168_84%_42%/0.05)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Why APEX"
          title="Everything You Need to Succeed"
          subtitle="We've removed every barrier between you and a six-figure income. Here's what you get when you join APEX."
        />

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {benefits.map((benefit, index) => (
            <motion.div key={index} variants={itemVariants}>
              <GlassCard
                className="h-full p-6 group"
                hoverEffect
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <benefit.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{benefit.title}</h3>
                <p className="text-sm text-muted-foreground">{benefit.description}</p>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
