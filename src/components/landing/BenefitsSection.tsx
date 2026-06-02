import { 
  DollarSign, GraduationCap, Calendar, Target, 
  Users, Trophy, Zap, HeartHandshake
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const benefits = [
  { icon: DollarSign, title: "50–145% commission", description: "Real rates, paid weekly. Production bonuses up to $25K/mo on top." },
  { icon: Target,     title: "Warm leads, daily",  description: "No cold calling. Prospects already asked for the appointment." },
  { icon: GraduationCap, title: "Scripts that close", description: "Same scripts our top producers use. Mentorship from day one." },
  { icon: Calendar,   title: "Your schedule",       description: "Work from anywhere. Set your own hours. Build the business around your life." },
  { icon: Users,      title: "Team that picks up",  description: "Daily team huddle, weekly closer call, Discord that's never quiet." },
  { icon: Trophy,     title: "Build your own team", description: "Clear path to manager. Earn overrides on every producing agent under you." },
  { icon: Zap,        title: "$10K in 90 days",     description: "Fast-start bonuses for new agents who execute the playbook." },
  { icon: HeartHandshake, title: "Protect real families", description: "Every policy is generational wealth for the family you wrote it for." },
];

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-24 relative bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(168_84%_42%/0.04)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Why APEX"
          title="Everything that closes. Nothing that doesn't."
          subtitle="Lead flow, scripts, weekly pay, real mentorship. You bring the work."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          {benefits.map((b, i) => (
            <div
              key={i}
              className="reveal group relative rounded-xl p-6 bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] hover:border-[#334155] transition-all duration-300"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              {/* Green left border accent */}
              <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-[#22d3a5] opacity-60 group-hover:opacity-100 transition-opacity" />
              
              <div className="pl-3">
                <div className="w-12 h-12 rounded-lg bg-[#22d3a5]/10 flex items-center justify-center mb-4 group-hover:bg-[#22d3a5]/20 transition-colors">
                  <b.icon className="h-6 w-6 text-[#22d3a5]" />
                </div>
                <h3 className="text-lg font-bold mb-2 text-[#f1f5f9] font-display">{b.title}</h3>
                <p className="text-sm text-[#94a3b8]">{b.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
