import { useState, useRef, useEffect } from "react";
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
    value: 92,
    suffix: "%",
    description: "of agents report increased production after implementing APEX platform",
    gradient: "from-orange-500 to-red-400",
  },
  {
    value: 14.3,
    suffix: "",
    description: "hours saved per agent each week through automated workflows",
    gradient: "from-blue-500 to-indigo-500",
    decimals: 1,
  },
  {
    value: 3,
    suffix: "x",
    description: "faster agent onboarding compared to industry standard processes",
    gradient: "from-purple-500 to-violet-400",
  },
];

export function SystemsSection() {
  const [activeTab, setActiveTab] = useState("core");

  return (
    <section id="systems" className="relative py-24 md:py-32 overflow-hidden bg-[#030712]">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        {/* Section Header */}
        <div className="reveal text-center mb-12">
          <SectionHeading
            badge="Our Platform"
            title="Technology That Powers Your Success"
            subtitle="Everything you need to scale your agency efficiently, from technology to contracts to support."
          />
          
          {/* Powered by APEX badge */}
          <div className="landing-scale-in landing-delay-300 flex items-center justify-center gap-2 mt-6">
            <Crown className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-wide text-primary uppercase">
              Powered by APEX
            </span>
            <Crown className="h-5 w-5 text-primary" />
          </div>
        </div>

        {/* Main Tabs Container */}
        <div className="reveal" style={{ transitionDelay: "120ms" }}>
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
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full transition-all duration-300" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div key={activeTab} className="landing-fade-in grid grid-cols-1 md:grid-cols-2 gap-6">
              {features[activeTab as keyof typeof features].map((feature, index) => (
                <div
                  key={feature.title}
                  className="landing-scale-in"
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <FeatureCard {...feature} />
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Stats Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
          {stats.map((stat, index) => (
            <div
              key={stat.value}
              className="reveal"
              style={{ transitionDelay: `${240 + index * 80}ms` }}
            >
              <StatCard {...stat} />
            </div>
          ))}
        </div>
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
    <div className="group relative p-6 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
      {/* Subtle glow on hover */}
      <div className="absolute inset-0 rounded-xl bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative flex gap-4">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="w-12 h-12 rounded-lg bg-muted/80 flex items-center justify-center group-hover:bg-primary/10 group-hover:scale-110 transition-all duration-300">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors duration-300">
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
  value: number;
  suffix: string;
  description: string;
  gradient: string;
  decimals?: number;
}

function StatCard({ value, suffix, description, gradient, decimals = 0 }: StatCardProps) {
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasStarted) {
          setHasStarted(true);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;

    const duration = 2000;
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = easeOutQuart * value;
      
      setCount(decimals > 0 ? parseFloat(currentValue.toFixed(decimals)) : Math.floor(currentValue));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [value, hasStarted, decimals]);

  return (
    <div 
      ref={ref}
      className={`
        relative overflow-hidden rounded-xl p-6 text-white
        bg-gradient-to-br ${gradient}
        before:absolute before:inset-0 before:bg-gradient-to-r before:from-white/0 before:via-white/20 before:to-white/0
        before:translate-x-[-200%] before:animate-[shimmer_3s_ease-in-out_infinite]
      `}
      style={{
        backgroundSize: '200% 200%',
        animation: 'gradientShift 4s ease infinite',
      }}
    >
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-200%); }
          100% { transform: translateX(200%); }
        }
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
      {/* Decorative overlay */}
      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 animate-pulse" />
      
      <div className="relative">
        <div className="text-4xl md:text-5xl font-bold mb-2">
          {decimals > 0 ? count.toFixed(decimals) : count}{suffix}
        </div>
        <p className="text-sm text-white/90 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
