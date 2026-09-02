import {
  BarChart3,
  FileCheck2,
  GraduationCap,
  Headphones,
  Network,
  Smartphone,
  UserPlus,
  Workflow,
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const benefits = [
  { icon: UserPlus, title: "Recruiting CRM", description: "Applications, interviews, follow-ups, hires, and ownership stay in one operating view." },
  { icon: FileCheck2, title: "One-link onboarding", description: "Licensed and unlicensed recruits enter the correct guided workflow from the start." },
  { icon: Workflow, title: "Contracting operations", description: "Intake, required documents, carrier steps, and support are visible without guesswork." },
  { icon: GraduationCap, title: "Structured training", description: "Clear modules, progress checkpoints, and next actions move every agent toward field readiness." },
  { icon: BarChart3, title: "Live production", description: "See personal, team, sub-agency, and total production without mixing the hierarchy." },
  { icon: Network, title: "Hierarchy control", description: "Owners and managers see the agents and numbers that belong to their organization." },
  { icon: Headphones, title: "Human support", description: "Agents always know who to contact for licensing, contracting, training, or field help." },
  { icon: Smartphone, title: "Mobile command center", description: "The core hiring and production workflows stay fast and usable from a phone." },
];

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-24 relative bg-white dark:bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(168_84%_42%/0.04)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Built for the whole agency"
          title="The tools to recruit, launch, manage, and scale."
          subtitle="Every capability is organized around the work your agents and leaders need to complete next."
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
