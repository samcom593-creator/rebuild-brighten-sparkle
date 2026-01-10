import { motion } from "framer-motion";
import {
  BookOpen,
  ClipboardCheck,
  FileCheck,
  Users,
  FileSignature,
  GraduationCap,
  Smartphone,
  Headphones,
  Target,
  DollarSign,
  Home,
  TrendingUp,
  MessageCircle,
  Award,
  UserPlus,
  UsersRound,
  Building2,
  Crown,
  Sparkles,
  Clock,
  MapPin,
  Zap,
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useLeadCounter } from "@/hooks/useLeadCounter";

interface Phase {
  name: string;
  subtitle: string;
  color: string;
  bgColor: string;
  borderColor: string;
  steps: Step[];
}

interface Step {
  icon: typeof BookOpen;
  title: string;
  description: string;
  benefit: string;
}

// Phase connector colors for the animated lines
const phaseConnectorColors = [
  "from-orange-500 to-blue-500",
  "from-blue-500 to-primary",
  "from-primary to-purple-500",
];

const phases: Phase[] = [
  {
    name: "Phase 1: Foundation",
    subtitle: "Become a Licensed Life Insurance Agent",
    color: "text-orange-400",
    bgColor: "from-orange-500/20 to-orange-600/10",
    borderColor: "border-l-orange-500",
    steps: [
      {
        icon: BookOpen,
        title: "Enroll in Pre-Licensing Course",
        description: "Get access to our partner program for pre-licensing education. Pass your exam on the first try with our study guides and exam prep materials.",
        benefit: "✓ Study guides included",
      },
      {
        icon: ClipboardCheck,
        title: "Pass the State Exam",
        description: "Schedule and pass your state life insurance exam with our proven preparation methods.",
        benefit: "✓ Exam prep support",
      },
      {
        icon: FileCheck,
        title: "Get Your State License",
        description: "Submit fingerprints and background check. Apply to your state's Department of Insurance and receive your license.",
        benefit: "✓ Step-by-step guidance",
      },
    ],
  },
  {
    name: "Phase 2: Structure",
    subtitle: "Set Up Your Business Operations",
    color: "text-blue-400",
    bgColor: "from-blue-500/20 to-blue-600/10",
    borderColor: "border-l-blue-500",
    steps: [
      {
        icon: Users,
        title: "Join Our Onboarding Process",
        description: "Complete your carrier contracting through APEX. Get access to our training platform and agent tools.",
        benefit: "✓ Full platform access",
      },
      {
        icon: FileSignature,
        title: "Receive & Submit Carrier Contracts",
        description: "Sign contracts with top carriers for the products you want to sell. Access over 50 carriers through our platform.",
        benefit: "✓ 50+ carriers available",
      },
      {
        icon: GraduationCap,
        title: "Complete the Virtual Sales Bootcamp",
        description: "Intensive virtual training with live coaching on scripts, objection handling, and closing techniques.",
        benefit: "✓ Live coaching sessions",
      },
      {
        icon: Smartphone,
        title: "Access Your Free CRM Platform",
        description: "Full access to our APEX CRM with lead management, automated follow-ups, and pipeline tracking.",
        benefit: "✓ Completely free",
      },
      {
        icon: Headphones,
        title: "Get Set Up With Our Free Dialer System",
        description: "Power dialer access to maximize your call volume with built-in scripts and auto-call recording.",
        benefit: "✓ Auto-recording included",
      },
    ],
  },
  {
    name: "Phase 3: Production",
    subtitle: "Start Selling & Earning Income",
    color: "text-primary",
    bgColor: "from-primary/20 to-emerald-600/10",
    borderColor: "border-l-primary",
    steps: [
      {
        icon: Target,
        title: "Start Working Free Real-Time Leads",
        description: "Receive exclusive leads immediately. Our warm leads are pre-qualified and ready for your call.",
        benefit: "✓ Exclusive warm leads",
      },
      {
        icon: DollarSign,
        title: "Earn Income Quickly & Efficiently",
        description: "Commission payouts within 72 hours. Competitive rates from 50%-145% based on production.",
        benefit: "✓ 72-hour payouts",
      },
      {
        icon: Home,
        title: "Transition Into Mortgage Protection Sales",
        description: "Expand beyond final expense into mortgage protection for families seeking coverage.",
        benefit: "✓ Higher premiums",
      },
      {
        icon: TrendingUp,
        title: "Convert Mortgage Clients Into IUL Clients",
        description: "Cross-sell Indexed Universal Life policies for higher premiums and commissions.",
        benefit: "✓ Bigger commissions",
      },
    ],
  },
  {
    name: "Phase 4: Scale",
    subtitle: "Expand Your Income & Influence",
    color: "text-purple-400",
    bgColor: "from-purple-500/20 to-purple-600/10",
    borderColor: "border-l-purple-500",
    steps: [
      {
        icon: MessageCircle,
        title: "Strategy Call With Our Senior Advisors",
        description: "One-on-one mentorship calls to discuss your growth strategy and production goals.",
        benefit: "✓ Personal mentorship",
      },
      {
        icon: Award,
        title: "Become a Consistent 5-Figure Monthly Earner",
        description: "Reach and maintain $10K+ monthly income with consistent activity and closing ratios.",
        benefit: "✓ Proven system",
      },
      {
        icon: UserPlus,
        title: "Plug Into Our Recruiting Systems",
        description: "Access APEX recruiting tools, scripts, and training to build your own team of agents.",
        benefit: "✓ Recruiting toolkit",
      },
      {
        icon: UsersRound,
        title: "Build a Team & Replicate Your Success",
        description: "Earn override commissions on your team's production. Managers earn $300K+ annually.",
        benefit: "✓ Override income",
      },
      {
        icon: Building2,
        title: "Establish Your Own Agency Brand",
        description: "Build your legacy with APEX support. Private-label your own agency while leveraging our systems.",
        benefit: "✓ Full agency support",
      },
    ],
  },
];

const whyAgentsChoose = [
  {
    icon: DollarSign,
    title: "Top Commission Rates",
    description: "Earn 50%-145% on every policy with APEX",
  },
  {
    icon: Target,
    title: "Free Lead Program",
    description: "Access to 166,000+ warm leads ready to convert",
  },
  {
    icon: GraduationCap,
    title: "No Experience Needed",
    description: "Complete training from licensing to closing",
  },
  {
    icon: Zap,
    title: "Fast Commission Payouts",
    description: "Get paid within 72 hours of policy approval",
  },
  {
    icon: MapPin,
    title: "Work From Anywhere",
    description: "Build your business on your schedule",
  },
  {
    icon: UsersRound,
    title: "Build Your Own Team",
    description: "Earn overrides and establish your agency",
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

export function CareerPathwaySection() {
  const { count, isLoading } = useLeadCounter();

  const stats = [
    { value: "$150M+", label: "Premium Generated" },
    { value: "166K+", label: "Lead Volume" },
    { value: "50+", label: "Carrier Partners" },
    { value: isLoading ? "..." : `${count}+`, label: "Active Agents", isLive: true },
  ];

  let stepNumber = 0;

  return (
    <section id="career" className="py-24 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.08)_0%,transparent_60%)]" />
      
      {/* Floating orbs */}
      <motion.div
        className="absolute top-40 left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl"
        animate={{ y: [0, -30, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-60 right-10 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl"
        animate={{ y: [0, 30, 0], opacity: [0.2, 0.3, 0.2] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      <div className="container mx-auto px-4 relative z-10">
        {/* Stats Banner */}
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {stats.map((stat, index) => (
            <motion.div key={index} variants={itemVariants}>
              <GlassCard className="p-6 text-center relative group" hoverEffect>
                {stat.isLive && (
                  <div className="absolute top-3 right-3">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                  </div>
                )}
                <div className="text-2xl md:text-3xl font-bold gradient-text mb-1">
                  {stat.isLive && !isLoading ? (
                    <>
                      <AnimatedCounter value={count} />+
                    </>
                  ) : (
                    stat.value
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>

        {/* Section Header */}
        <SectionHeading
          badge="Career Path"
          title="Your 17-Step Career Path"
          subtitle="Follow our proven path to financial freedom. From licensing to building your own agency, we guide you every step of the way."
        />

        {/* Career Phases */}
        <div className="mt-16 space-y-4">
          {phases.map((phase, phaseIndex) => (
            <div key={phaseIndex}>
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: phaseIndex * 0.1 }}
              >
                {/* Phase Header */}
                <div className={`mb-6 pl-4 border-l-4 ${phase.borderColor}`}>
                  <h3 className={`text-xl md:text-2xl font-bold ${phase.color}`}>
                    {phase.name}
                  </h3>
                  <p className="text-muted-foreground">{phase.subtitle}</p>
                </div>

                {/* Steps Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {phase.steps.map((step, stepIndex) => {
                    stepNumber++;
                    return (
                      <motion.div
                        key={stepIndex}
                        variants={itemVariants}
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        transition={{ delay: stepIndex * 0.05 }}
                      >
                        <GlassCard
                          className="h-full p-5 group hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
                          hoverEffect={false}
                        >
                          <div className="flex gap-4">
                            {/* Step Number Circle */}
                            <div className={`flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br ${phase.bgColor} flex items-center justify-center border border-white/10`}>
                              <span className={`text-sm font-bold ${phase.color}`}>
                                {stepNumber}
                              </span>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 mb-2">
                                <step.icon className={`h-5 w-5 ${phase.color} flex-shrink-0 mt-0.5`} />
                                <h4 className="font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">
                                  {step.title}
                                </h4>
                              </div>
                              <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                                {step.description}
                              </p>
                              <span className={`inline-block text-xs font-medium ${phase.color} bg-white/5 px-2 py-1 rounded-full`}>
                                {step.benefit}
                              </span>
                            </div>
                          </div>
                        </GlassCard>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>

              {/* Animated Connector Line between phases */}
              {phaseIndex < phases.length - 1 && (
                <motion.div
                  className="flex justify-center py-8"
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <div className="relative flex flex-col items-center">
                    {/* Animated gradient line */}
                    <div className="relative w-1 h-16 rounded-full overflow-hidden bg-border/30">
                      <motion.div
                        className={`absolute inset-0 w-full bg-gradient-to-b ${phaseConnectorColors[phaseIndex]}`}
                        initial={{ y: "-100%" }}
                        whileInView={{ y: "0%" }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                      />
                      {/* Animated pulse effect */}
                      <motion.div
                        className={`absolute inset-0 w-full bg-gradient-to-b ${phaseConnectorColors[phaseIndex]} opacity-50`}
                        animate={{
                          y: ["-100%", "100%"],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut",
                          repeatDelay: 1,
                        }}
                      />
                    </div>
                    
                    {/* Animated arrow */}
                    <motion.div
                      className="mt-2"
                      animate={{ y: [0, 4, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-primary"
                      >
                        <motion.path
                          d="M12 5L12 19M12 19L6 13M12 19L18 13"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0, opacity: 0 }}
                          whileInView={{ pathLength: 1, opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, delay: 0.5 }}
                        />
                      </svg>
                    </motion.div>

                    {/* Glowing dot at transition */}
                    <motion.div
                      className={`absolute top-0 w-3 h-3 rounded-full bg-gradient-to-r ${phaseConnectorColors[phaseIndex]}`}
                      animate={{
                        boxShadow: [
                          "0 0 10px 2px rgba(45, 212, 191, 0.3)",
                          "0 0 20px 4px rgba(45, 212, 191, 0.5)",
                          "0 0 10px 2px rgba(45, 212, 191, 0.3)",
                        ],
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>

        {/* Why Agents Choose Us */}
        <motion.div
          className="mt-24"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <SectionHeading
            title="Why Agents Choose APEX"
            subtitle="Everything you need to build a successful career in life insurance."
          />

          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
          >
            {whyAgentsChoose.map((item, index) => (
              <motion.div key={index} variants={itemVariants}>
                <GlassCard className="p-6 group" hoverEffect>
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                    <item.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Powered by APEX Badge */}
        <motion.div
          className="mt-16 text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
        >
          <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full glass border border-primary/30">
            <Crown className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">
              <Sparkles className="h-4 w-4 inline-block text-primary mr-1" />
              Powered by <span className="gradient-text font-bold">APEX</span>
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
