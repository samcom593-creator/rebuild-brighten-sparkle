import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ArrowRight, GraduationCap, Award, FileCheck, Phone, Users, Briefcase, BookOpen, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const licensedSteps = [
  { icon: FileCheck, title: "Application Submitted", desc: "Apply through our portal", color: "text-blue-400" },
  { icon: Phone, title: "Phone Interview", desc: "15-min screening call", color: "text-violet-400" },
  { icon: CheckCircle, title: "Hired & Contracted", desc: "Background check + contracting", color: "text-emerald-400" },
  { icon: BookOpen, title: "Onboarding Course", desc: "Complete training modules", color: "text-amber-400" },
  { icon: Users, title: "Field Training", desc: "Shadow a top producer", color: "text-primary" },
  { icon: Briefcase, title: "Live in Field", desc: "Start producing independently", color: "text-orange-400" },
];

const unlicensedSteps = [
  { icon: FileCheck, title: "Application Submitted", desc: "Apply through our portal", color: "text-blue-400" },
  { icon: Phone, title: "Phone Interview", desc: "15-min screening call", color: "text-violet-400" },
  { icon: GraduationCap, title: "Purchase Pre-Licensing Course", desc: "ExamFX or Kaplan recommended", color: "text-amber-400" },
  { icon: BookOpen, title: "Study & Pass Exam", desc: "2-4 weeks average timeline", color: "text-orange-400" },
  { icon: Shield, title: "Get Licensed (NPN)", desc: "Apply for your state license", color: "text-emerald-400" },
  { icon: CheckCircle, title: "Contracted with Carriers", desc: "We handle all paperwork", color: "text-primary" },
  { icon: Users, title: "Onboarding + Field Training", desc: "Training modules + shadow", color: "text-pink-400" },
  { icon: Briefcase, title: "Live in Field", desc: "Start earning!", color: "text-orange-400" },
];

function FlowTimeline({ steps, title, accent }: { steps: typeof licensedSteps; title: string; accent: string }) {
  return (
    <GlassCard className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Award className={cn("h-6 w-6", accent)} />
        <h2 className="text-xl font-display font-bold">{title}</h2>
        <Badge className={cn("ml-auto", accent === "text-emerald-400" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
          {steps.length} steps
        </Badge>
      </div>
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-4 group">
            <div className="flex flex-col items-center">
              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all",
                `border-current ${step.color} bg-current/10`
              )}>
                <step.icon className={cn("h-5 w-5", step.color)} />
              </div>
              {i < steps.length - 1 && <div className="w-0.5 h-8 bg-border" />}
            </div>
            <div className="pt-1.5 pb-4">
              <p className="font-semibold text-sm">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

export default function AgentFlow() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-display font-extrabold">Agent Onboarding Flow</h1>
        <p className="text-muted-foreground">Two paths to becoming an APEX elite agent</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <FlowTimeline steps={licensedSteps} title="Licensed Agent Path" accent="text-emerald-400" />
        <FlowTimeline steps={unlicensedSteps} title="Unlicensed Agent Path" accent="text-amber-400" />
      </div>
    </div>
  );
}
