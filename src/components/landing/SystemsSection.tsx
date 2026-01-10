import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Globe, 
  LayoutDashboard, 
  RefreshCw, 
  Database,
  MessageSquare,
  TrendingUp,
  Calendar,
  Smartphone,
  Users,
  Zap,
  Mail,
  MessageCircle,
  Crown
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { SectionHeading } from "@/components/ui/section-heading";

const tabs = [
  { id: "core", label: "Core Platform" },
  { id: "sales", label: "Sales Tools" },
  { id: "communication", label: "Communication" },
];

const features = {
  core: [
    {
      icon: Globe,
      title: "Agency Portal",
      description: "Custom branded portals for your agency, keeping your brand front and center with personalized domain options.",
    },
    {
      icon: LayoutDashboard,
      title: "Production Dashboards",
      description: "Real-time insights into team performance, sales metrics, and growth opportunities with automated reporting.",
    },
    {
      icon: RefreshCw,
      title: "Automated Onboarding",
      description: "Streamlined agent onboarding with automatic contracting and training sequences that reduce time-to-production.",
    },
    {
      icon: Database,
      title: "CRM Integration",
      description: "Seamless integration with leading CRMs or use our built-in solution designed specifically for life insurance agencies.",
    },
  ],
  sales: [
    {
      icon: MessageSquare,
      title: "Warm Market Systems",
      description: "Proven scripts, email templates, and outreach campaigns to generate more leads from existing networks.",
    },
    {
      icon: TrendingUp,
      title: "Quote Comparison Tools",
      description: "Multi-carrier quote comparison tools that help clients understand options and help agents close more business.",
    },
    {
      icon: Calendar,
      title: "Appointment Scheduling",
      description: "Automated scheduling tools with calendar integration to eliminate back-and-forth and reduce no-shows.",
    },
    {
      icon: Smartphone,
      title: "Mobile App",
      description: "Powerful mobile experience for agents on the go with client management, quoting, and e-applications.",
    },
  ],
  communication: [
    {
      icon: Users,
      title: "Team Collaboration",
      description: "Built-in team communication tools for efficient case collaboration and knowledge sharing between agents.",
    },
    {
      icon: Zap,
      title: "Automated Follow-ups",
      description: "Smart follow-up sequences that ensure no lead falls through the cracks and increase conversion rates.",
    },
    {
      icon: Mail,
      title: "Email Campaigns",
      description: "Professionally designed email templates and campaign management for consistent client communication.",
    },
    {
      icon: MessageCircle,
      title: "Text Messaging",
      description: "Compliant SMS messaging tools for appointment reminders and important client communications.",
    },
  ],
};

const stats = [
  {
    value: "92%",
    description: "of agents report increased production after implementing APEX platform",
    gradient: "from-orange-500 to-red-400",
  },
  {
    value: "14.3",
    description: "hours saved per agent each week through automated workflows",
    gradient: "from-blue-500 to-indigo-500",
  },
  {
    value: "3x",
    description: "faster agent onboarding compared to industry standard processes",
    gradient: "from-purple-500 to-violet-400",
  },
];

export function SystemsSection() {
  const [activeTab, setActiveTab] = useState("core");

  return (
    <section id="systems" className="relative py-24 md:py-32 overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <SectionHeading
            badge="Our Platform"
            title="Technology That Powers Your Success"
            subtitle="Everything you need to scale your agency efficiently, from technology to contracts to support."
          />
          
          {/* Powered by APEX badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="flex items-center justify-center gap-2 mt-6"
          >
            <Crown className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-wide text-primary uppercase">
              Powered by APEX
            </span>
            <Crown className="h-5 w-5 text-primary" />
          </motion.div>
        </motion.div>

        {/* Main Tabs Container */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          <GlassCard variant="strong" className="p-6 md:p-10">
            {/* Tab Navigation */}
            <div className="flex flex-wrap justify-center gap-2 mb-8 border-b border-border/50 pb-4">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    relative px-6 py-3 text-sm font-medium transition-all duration-300 rounded-lg
                    ${activeTab === tab.id 
                      ? "text-primary bg-primary/10" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }
                  `}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-6"
              >
                {features[activeTab as keyof typeof features].map((feature, index) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1, duration: 0.4 }}
                  >
                    <FeatureCard {...feature} />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </GlassCard>
        </motion.div>

        {/* Stats Banner */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10"
        >
          {stats.map((stat, index) => (
            <motion.div
              key={stat.value}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 + index * 0.1, duration: 0.4 }}
            >
              <StatCard {...stat} />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

interface FeatureCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="group relative p-6 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-all duration-300">
      {/* Subtle glow on hover */}
      <div className="absolute inset-0 rounded-xl bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative flex gap-4">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="w-12 h-12 rounded-lg bg-muted/80 flex items-center justify-center group-hover:bg-primary/10 transition-colors duration-300">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  value: string;
  description: string;
  gradient: string;
}

function StatCard({ value, description, gradient }: StatCardProps) {
  return (
    <div className={`
      relative overflow-hidden rounded-xl p-6 text-white
      bg-gradient-to-br ${gradient}
    `}>
      {/* Decorative overlay */}
      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
      
      <div className="relative">
        <div className="text-4xl md:text-5xl font-bold mb-2">
          {value}
        </div>
        <p className="text-sm text-white/90 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
