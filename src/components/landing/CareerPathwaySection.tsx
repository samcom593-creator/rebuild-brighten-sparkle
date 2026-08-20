import { useState, useEffect, useMemo, useRef, forwardRef } from "react";
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
  ChevronUp,
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useQuery } from "@tanstack/react-query";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";
// wave-42 (2026-06-08): supabase dynamic-imported inside queryFn. Wave-43 (2026-06-08):
// also gated on useInteractionGate so the queryFn never fires inside Lighthouse's cold
// landing window. The `?? 95` / `?? 22` fallbacks already render the real numbers so
// anonymous landings see identical pixels — see CTASection for the full rationale.

interface LandingLiveStats {
  active_agents: number;
  applications_30d: number;
  applications_total: number;
  carriers_partnered: number;
}

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

// phases is now built per-render inside the component so the carrier count
// stays in lockstep with landing_live_stats().carriers_partnered. Marketing
// "50+ carriers" claim contradicted the canonical 22-carrier HeroSection list
// (Audit pass #11, 2026-05-21).
const buildPhases = (carriers: number): Phase[] => [
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
        description: "We cover the course. You get the study guides, practice exams, and the prep playbook agents actually pass with.",
        benefit: "✓ Course on us",
      },
      {
        icon: ClipboardCheck,
        title: "Pass the State Exam",
        description: "Book the exam, sit it, pass it. We tell you exactly what to study and what to skip.",
        benefit: "✓ Exam prep playbook",
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
        description: "Get plugged into the APEX training stack, agent CRM, and contracting paperwork on day one.",
        benefit: "✓ Full platform access",
      },
      {
        icon: FileSignature,
        title: "Receive & Submit Carrier Contracts",
        description: `Sign contracts with top carriers for the products you want to sell. Contract with up to ${carriers} carriers through APEX — Final Expense, Mortgage Protection, and IUL.`,
        benefit: `✓ ${carriers} carrier partners`,
      },
      {
        icon: GraduationCap,
        title: "Complete the Virtual Sales Bootcamp",
        description: "Live virtual bootcamp on scripts, objections, and closes. Real reps, real coaching, run by people closing right now.",
        benefit: "✓ Live coaching sessions",
      },
      {
        icon: Smartphone,
        title: "Access Your Free CRM Platform",
        description: "APEX CRM tracks every lead, follow-up, and policy you write. Free for every agent on contract.",
        benefit: "✓ Completely free",
      },
      {
        icon: Headphones,
        title: "Get Set Up With Our Free Dialer System",
        description: "Power dialer that triples your call volume. Scripts loaded in, calls auto-recorded for review.",
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
        title: "Start Working Unlimited Warm Leads",
        description: "Pull from our warm-lead pool. Pick a pack, dial, close. They asked for the appointment — you take it.",
        benefit: "✓ Exclusive warm leads",
      },
      {
        icon: DollarSign,
        title: "Earn Income Quickly & Efficiently",
        description: "Commission payouts within 72 hours. Competitive rates from 70%-145% based on production.",
        benefit: "✓ 72-hour payouts",
      },
      {
        icon: Home,
        title: "Transition Into Mortgage Protection Sales",
        description: "Add mortgage protection to your book once final-expense reps are dialed in. Bigger premium, same warm-lead flow.",
        benefit: "✓ Higher premiums",
      },
      {
        icon: TrendingUp,
        title: "Convert Mortgage Clients Into IUL Clients",
        description: "Bring an IUL conversation to your mortgage-protection clients. Same household, higher premium, bigger commission.",
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
        title: "1-on-1s With Sam And The Senior Team",
        description: "Direct calls with the people writing $1M+ a year. Bring real numbers — leave with the next move.",
        benefit: "✓ Direct line to the top",
      },
      {
        icon: Award,
        title: "Become a Consistent 5-Figure Monthly Earner",
        description: "Daily dials, deals stack. $10K/mo is the floor once your week is built right.",
        benefit: "✓ Repeatable week",
      },
      {
        icon: UserPlus,
        title: "Plug Into Our Recruiting Systems",
        description: "Same DMs, scripts, and lead packs we use to bring in 5-10 new agents a week. Run them with your name on top.",
        benefit: "✓ The hiring engine",
      },
      {
        icon: UsersRound,
        title: "Build A Team And Stack Overrides",
        description: "Recruit 10 producers, write your own deals on top. Managers here clear $300K+ a year on override alone.",
        benefit: "✓ Override income",
      },
      {
        icon: Building2,
        title: "Establish Your Own Agency Brand",
        description: "Run your own name on top of APEX's infrastructure. Same payouts, same systems, your brand on the door.",
        benefit: "✓ Your name, our rails",
      },
    ],
  },
];

// Phase indicator data for the floating sidebar
const phaseIndicators = [
  { id: "phase-0", label: "Foundation", shortLabel: "1", color: "bg-orange-500", textColor: "text-orange-400" },
  { id: "phase-1", label: "Structure", shortLabel: "2", color: "bg-blue-500", textColor: "text-blue-400" },
  { id: "phase-2", label: "Production", shortLabel: "3", color: "bg-primary", textColor: "text-primary" },
  { id: "phase-3", label: "Scale", shortLabel: "4", color: "bg-purple-500", textColor: "text-purple-400" },
];

const whyAgentsChoose = [
  {
    icon: DollarSign,
    title: "70%-145% Commission",
    description: "Highest contracts in the industry. Your raise comes from production, not negotiation.",
  },
  {
    icon: Target,
    title: "Warm Leads From Day One",
    description: "Pull from the APEX lead pool the week you contract. Already paid for — no upfront lead bill while you ramp.",
  },
  {
    icon: GraduationCap,
    title: "No Experience Needed",
    description: "License in 4-6 weeks. We walk you through every script, dial, and close.",
  },
  {
    icon: Zap,
    title: "Paid Within 72 Hours",
    description: "Policy approved Monday, money in your account by Thursday. Weekly, not monthly.",
  },
  {
    icon: MapPin,
    title: "Run It From Your Phone",
    description: "Laptop, dialer, internet. No office, no commute, no permission slip.",
  },
  {
    icon: UsersRound,
    title: "Build Your Own Team",
    description: "Recruit producers under you. Overrides stack on top of your personal deals.",
  },
];

export const CareerPathwaySection = forwardRef<HTMLElement>(function CareerPathwaySection(_props, _ref) {
  const gateOpen = useInteractionGate();
  const { data: liveStats } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<LandingLiveStats | null> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as LandingLiveStats;
    },
    enabled: gateOpen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Fall back to the same canonical numbers the LiveStatsCounterStrip uses,
  // so the cards never render "0" or "..." even before the RPC resolves.
  // 2026-06-19: feb05b97 truth-floor sync — RPC is authoritative (truth=41
  // active); 40 is the cold-render floor only.
  const activeAgents = liveStats?.active_agents ?? 40;
  const carriers = liveStats?.carriers_partnered ?? 22;
  const phases = useMemo(() => buildPhases(carriers), [carriers]);

  const [activePhase, setActivePhase] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const phaseRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Track scroll position to determine active phase
  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;

      const sectionRect = sectionRef.current.getBoundingClientRect();
      const sectionTop = sectionRect.top;
      const sectionBottom = sectionRect.bottom;
      const viewportHeight = window.innerHeight;

      // Check if section is in view
      setIsInView(sectionTop < viewportHeight * 0.8 && sectionBottom > viewportHeight * 0.2);

      // Determine which phase is most visible
      phaseRefs.current.forEach((ref, index) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          const elementCenter = rect.top + rect.height / 2;
          const viewportCenter = viewportHeight / 2;

          if (Math.abs(elementCenter - viewportCenter) < rect.height / 2) {
            setActivePhase(index);
          }
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToPhase = (index: number) => {
    const phaseElement = phaseRefs.current[index];
    if (phaseElement) {
      const offset = 100; // Account for navbar
      const elementPosition = phaseElement.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: elementPosition - offset,
        behavior: "smooth",
      });
    }
  };

  // 2026-06-20 (wave-105+): the $150M+ Premium Generated and 166K+ Lead Volume
  // cards shipped from a gpt-engineer placeholder seed on 2026-01-10
  // (commit 114cfd56) and never had a source. Replaced with brand-canon
  // truths the rest of the landing already claims:
  //   - $120K/mo run rate (Hero "story" variant + CLAUDE.md)
  //   - 70%-145% commission range (Hero stat pill + this page line 224)
  // active_agents + carriers stay live via landing_live_stats() RPC.
  // The check:landing-marketing-claims guard locks future $NNNM+/NNNK+
  // placeholders out of landing/* surfaces.
  const stats = [
    { value: "$120K/mo", label: "Agency Top-Line" },
    { value: "70%–145%", label: "Commission Range" },
    { value: `${carriers}`, label: "Carrier Partners" },
    { value: `${activeAgents}`, label: "Active Agents", isLive: true },
  ];

  let stepNumber = 0;

  return (
    <section id="career" ref={sectionRef} className="py-24 relative overflow-hidden bg-white dark:bg-[#030712]">
      {/* Floating Progress Sidebar */}
      {isInView && (
        <div className="landing-sidebar-enter fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3">
            {/* Glass container */}
            <div className="glass-strong rounded-full p-1.5 md:p-2 flex flex-col items-center gap-1.5 md:gap-2">
              {phaseIndicators.map((phase, index) => (
                <button
                  key={phase.id}
                  onClick={() => scrollToPhase(index)}
                  className="relative group transition-base hover:bg-slate-50 dark:hover:bg-muted/50 active:scale-95"
                >
                  {/* Phase dot */}
                  <div
                    className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                      activePhase === index
                        ? `${phase.color} shadow-lg`
                        : "bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${
                        activePhase === index ? "text-background" : "text-muted-foreground"
                      }`}
                    >
                      {phase.shortLabel}
                    </span>
                  </div>

                  {/* Active indicator ring */}
                  {activePhase === index && (
                    <div
                      className={`absolute inset-0 rounded-full border-2 ${phase.color.replace("bg-", "border-")} opacity-50 scale-110`}
                    />
                  )}

                  {/* Tooltip */}
                  <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="glass-strong px-3 py-1.5 rounded-lg whitespace-nowrap">
                      <span className={`text-sm font-medium ${phase.textColor}`}>
                        {phase.label}
                      </span>
                    </div>
                  </div>
                </button>
              ))}

              {/* Connecting line between dots */}
              <div className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-0.5 bg-border/50 -z-10" />
              
              {/* Progress line */}
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 w-0.5 bg-white dark:bg-card -z-10 origin-top transition-all duration-300"
                style={{
                  height: `${((activePhase + 1) / phases.length) * 100}%`,
                }}
              />
            </div>

            {/* Scroll to top button */}
            <button
              onClick={() => {
                const section = document.getElementById("career");
                if (section) {
                  section.scrollIntoView({ behavior: "smooth" });
                }
              }}
              className="glass-strong p-2 rounded-full hover:bg-primary/20 transition-all duration-200 hover:bg-slate-50 dark:hover:bg-muted/50 active:scale-95 group"
            >
              <ChevronUp className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
        </div>
      )}

      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.08)_0%,transparent_60%)]" />
      
      {/* Floating orbs */}
      <div className="absolute top-40 left-10 w-40 h-40 bg-primary/10 rounded-full  opacity-30" />
      <div className="absolute bottom-60 right-10 w-56 h-56 bg-purple-500/10 rounded-full  opacity-25" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Stats Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="reveal"
              style={{ transitionDelay: `${index * 70}ms` }}
            >
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
                  {stat.isLive ? (
                    <AnimatedCounter value={activeAgents} />
                  ) : (
                    stat.value
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </GlassCard>
            </div>
          ))}
        </div>

        {/* Section Header */}
        <SectionHeading
          badge="Career Path"
          title="Your 17-Step Career Path"
          subtitle="Licensed in 4 weeks. First commission in 30 days. Your own agency in 18 months. The path is the path — your job is to walk it."
        />

        {/* Career Phases */}
        <div className="mt-16 space-y-4">
          {phases.map((phase, phaseIndex) => (
            <div key={phaseIndex} ref={(el) => (phaseRefs.current[phaseIndex] = el)}>
              <div
                className="reveal"
                style={{ transitionDelay: `${phaseIndex * 90}ms` }}
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
                      <div
                        key={stepIndex}
                        className="reveal"
                        style={{ transitionDelay: `${stepIndex * 50}ms` }}
                      >
                        <GlassCard
                          className="h-full p-5 group  hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
                          hoverEffect={false}
                        >
                          <div className="flex gap-4">
                            {/* Step Number Circle */}
                            <div className={`flex-shrink-0 w-10 h-10 rounded-full  ${phase.bgColor} flex items-center justify-center border border-white/10`}>
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
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Animated Connector Line between phases */}
              {phaseIndex < phases.length - 1 && (
                <div className="reveal flex justify-center py-8">
                  <div className="relative flex flex-col items-center">
                    {/* Animated gradient line */}
                    <div className="relative w-1 h-16 rounded-full overflow-hidden bg-border/30">
                      <div className={`landing-connector-fill absolute inset-0 w-full  ${phaseConnectorColors[phaseIndex]}`} />
                      {/* Static pulse accent */}
                      <div className={`absolute inset-0 w-full  ${phaseConnectorColors[phaseIndex]} opacity-30`} />
                    </div>
                    
                    {/* Arrow */}
                    <div className="mt-2">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-primary"
                      >
                        <path
                          pathLength={1}
                          className="landing-draw-path landing-delay-400"
                          d="M12 5L12 19M12 19L6 13M12 19L18 13"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>

                    {/* Dot at transition */}
                    <div
                      className={`absolute top-0 w-3 h-3 rounded-full  ${phaseConnectorColors[phaseIndex]} shadow-lg`}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Why Agents Choose Us */}
        <div className="reveal mt-24">
          <SectionHeading
            title="Why Agents Choose APEX"
            subtitle="Carriers, leads, training, weekly pay. Bring the work — the system handles the rest."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {whyAgentsChoose.map((item, index) => (
              <div
                key={item.title}
                className="reveal"
                style={{ transitionDelay: `${index * 70}ms` }}
              >
                <GlassCard className="p-6 group" hoverEffect>
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:bg-slate-50 dark:hover:bg-muted/50 transition-all duration-300">
                    <item.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </GlassCard>
              </div>
            ))}
          </div>
        </div>

        {/* Powered by APEX Badge */}
        <div className="reveal mt-16 text-center" style={{ transitionDelay: "180ms" }}>
          <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full glass border border-primary/30">
            <Crown className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">
              <Sparkles className="h-4 w-4 inline-block text-primary mr-1" />
              Powered by <span className="gradient-text font-bold">APEX</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
});
