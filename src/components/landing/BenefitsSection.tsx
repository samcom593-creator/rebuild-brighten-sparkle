import { 
  DollarSign, GraduationCap, Calendar, Target, 
  Users, Trophy, Zap, HeartHandshake
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const benefits = [
  { icon: DollarSign, title: "Independent brokerage", description: "Access multiple carrier and product options based on licensing, eligibility, production, and carrier approval." },
  { icon: Target, title: "Lead-to-close execution", description: "Lead access, ReadyMode dialing, CRM workflows, scripts, and follow-up live in one operating path." },
  { icon: GraduationCap, title: "Training tied to action", description: "Learn the opener, discovery, field underwriting, objections, close, and post-sale process in order." },
  { icon: Calendar, title: "A visible next step", description: "Licensing, contracting, training, and production milestones show the one action that moves you forward." },
  { icon: Users, title: "Coaching with receipts", description: "Use live huddles, call review, production data, and manager accountability instead of motivational guesswork." },
  { icon: Trophy, title: "Producer-to-owner path", description: "Prove personal production, develop people, build a team, and graduate into manager or agency-owner mode." },
  { icon: Zap, title: "Recruiting infrastructure", description: "Referral links, source attribution, applicant routing, hierarchy, and downline results remain measurable as you scale." },
  { icon: HeartHandshake, title: "Work with real consequence", description: "Build a business by helping families protect income, final expenses, mortgages, and long-term financial goals." },
];

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-24 relative bg-white dark:bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(168_84%_42%/0.04)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Why APEX"
          title="The infrastructure behind the opportunity."
          subtitle="APEX connects the work most agencies leave scattered—from licensing and the first sale through recruiting, leadership, and ownership."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          {benefits.map((b, i) => (
            <div
              key={b.title}
              className="reveal group relative rounded-md p-6 bg-white dark:bg-card border border-[#1e293b] hover:border-[#334155] transition-all duration-300"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              {/* Green left border accent */}
              <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-[#e8bb2b] opacity-60 group-hover:opacity-100 transition-opacity" />
              
              <div className="pl-3">
                <div className="w-12 h-12 rounded-lg bg-[#e8bb2b]/10 flex items-center justify-center mb-4 group-hover:bg-[#e8bb2b]/20 transition-colors">
                  <b.icon className="h-6 w-6 text-[#e8bb2b]" />
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
