import { Link } from "react-router-dom";
import { ExternalLink, FileText, Headphones, Phone, PlayCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { resolveBrand } from "@/config/brand";

function onboardingResources(brandName: string) {
  return [
  {
    title: `Start here · ${brandName} onboarding`,
    detail: "Watch the orientation first.",
    href: "https://youtu.be/Gm62pf3SywU",
    icon: PlayCircle,
  },
  {
    title: "Script walkthrough",
    detail: "Learn the approved presentation flow.",
    href: "https://drive.google.com/file/d/1FZIMIdqDRf7HAox9egfVWpAvhterF2Vy/view?ts=6a8d0638",
    icon: PlayCircle,
  },
  {
    title: "Objection handling",
    detail: "Watch before taking live appointments.",
    href: "https://www.youtube.com/watch?v=jOtqBnnLsR0",
    icon: Headphones,
  },
  {
    title: "Field-release course",
    detail: "Complete every tracked video, transcript, and knowledge check.",
    href: "/dashboard/recruiting/training/sales-course",
    icon: PlayCircle,
    internal: true,
  },
  {
    title: `Official ${brandName} script`,
    detail: "Keep this open while practicing.",
    href: "https://docs.google.com/document/d/1OeDu_6TABfIJtVHrn1TrJUjWGzgehYttoMj7ttSebxI/edit?tab=t.0#heading=h.u8s4qkrx1od7",
    icon: FileText,
  },
  ] as const;
}

export function RequiredOnboardingResources() {
  const resources = onboardingResources(resolveBrand().shortName);
  return (
    <section aria-labelledby="required-onboarding-heading" className="space-y-3">
      <div>
        <h2 id="required-onboarding-heading" className="text-lg font-bold">Required onboarding resources</h2>
        <p className="text-sm text-muted-foreground">Keep these references close while you work through the tracked field-release course.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resources.map((resource, index) => {
          const content = (
            <Card className="flex h-full items-start gap-3 p-4 hover:border-primary/40">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <resource.icon className="h-4 w-4 text-primary" /> {resource.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{resource.detail}</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Card>
          );
          return "internal" in resource && resource.internal
            ? <Link key={resource.href} to={resource.href}>{content}</Link>
            : <a key={resource.href} href={resource.href} target="_blank" rel="noopener noreferrer">{content}</a>;
        })}
        <a href="tel:+19788047212">
          <Card className="flex h-full items-start gap-3 border-primary/30 p-4 hover:border-primary">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Phone className="h-4 w-4" /></span>
            <span>
              <span className="block text-sm font-semibold">Onboarding help · Aisha</span>
              <span className="mt-1 block text-xs text-muted-foreground">Call or text 978-804-7212</span>
            </span>
          </Card>
        </a>
      </div>
    </section>
  );
}

export default RequiredOnboardingResources;
