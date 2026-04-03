import { motion } from "framer-motion";
import { 
  DollarSign, GraduationCap, Calendar, Target, 
  Users, Trophy, Zap, HeartHandshake
} from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const benefits = [
  { icon: DollarSign, title: "Industry-Leading Commissions", description: "Earn 50%-145% commission rates with bonuses up to $25K per month." },
  { icon: Target, title: "Exclusive Lead Program", description: "Receive unlimited exclusive leads. No cold calling—only prospects ready to buy." },
  { icon: GraduationCap, title: "World-Class Training", description: "Access our proven sales system, scripts, and mentorship from day one." },
  { icon: Calendar, title: "Flexible Schedule", description: "Work from anywhere, set your own hours. Build your business around your life." },
  { icon: Users, title: "Team Culture & Support", description: "Weekly masterminds, team calls, and 24/7 support when you need it." },
  { icon: Trophy, title: "Career Advancement", description: "Clear path to management. Build your own team and earn overrides." },
  { icon: Zap, title: "Fast-Start Bonuses", description: "Earn up to $10,000 in bonuses your first 90 days." },
  { icon: HeartHandshake, title: "Meaningful Work", description: "Protect families and build generational wealth for your clients." },
];

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-24 relative bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(168_84%_42%/0.04)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Why APEX"
          title="Everything You Need to Succeed"
          subtitle="We've removed every barrier between you and a six-figure income."
        />

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08 } } }}
        >
          {benefits.map((b, i) => (
            <motion.div
              key={i}
              variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }}
              className="group relative rounded-xl p-6 bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] hover:border-[#334155] transition-all duration-300"
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
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
