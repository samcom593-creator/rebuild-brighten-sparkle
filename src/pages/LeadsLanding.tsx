import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, TrendingUp, Users, Award, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";

// Default export required because App.tsx loads this via React.lazy
// (`lazy(() => import("./pages/LeadsLanding"))`). Without it,
// /leads, /get-leads, and /dialer all crash with React error #306
// "element type is invalid: undefined."
export default function LeadsLanding() {
  usePageTitle("APEX Leads & Dialer · Daily Warm Leads");
  return (
    <div className="min-h-screen bg-white dark:bg-card">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-sm border-b border-slate-200 dark:border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link to="/" className="text-2xl font-bold text-foreground">
            APEX FINANCIAL
          </Link>
          <Button asChild variant="outline">
            <Link to="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </nav>

      <main>
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-32 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          {/* Animated background gradient */}
          <div className="absolute inset-0 bg-white dark:bg-card " />
          
          <div className="relative space-y-8 text-center">
            <div className="inline-block">
              <div className="px-4 py-2 rounded-full border border-teal-400/50 bg-teal-400/10 text-sm text-teal-300 font-medium">
                Built for agents who dial, not browse.
              </div>
            </div>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight">
              Get <span className="text-primary">Qualified Leads</span> Delivered Daily
            </h1>
            
            <p className="text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Stop cold calling. Get warm leads delivered daily with the same dialer, coaching, and comp structure built to help serious agents push toward $10,000 months.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
              <Button asChild size="lg" className="bg-white dark:bg-card hover:from-teal-600 hover:to-teal-700 text-white border-0">
                <Link to="/get-licensed" className="gap-2">
                  Get Started <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              {/* Was self-looping back to /dialer (which IS this page).
                  Anchors to the platform-demo section so the button
                  actually shows the demo content. */}
              <Button asChild variant="outline" size="lg">
                <a href="#platform-demo">See Platform Demo</a>
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-16">
              <div className="space-y-2">
                <div className="text-3xl font-bold text-teal-400">$10K+</div>
                <p className="text-muted-foreground">Monthly pace serious agents can build toward</p>
              </div>
              <div className="space-y-2">
                <div className="text-3xl font-bold text-blue-400">Warm</div>
                <p className="text-muted-foreground">Daily lead flow</p>
              </div>
              <div className="space-y-2">
                <div className="text-3xl font-bold text-teal-400">Scalable</div>
                <p className="text-muted-foreground">Coaching, dialer, and recruiting support</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-50 dark:bg-muted/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">
              Why APEX Agents Win
            </h2>
            <p className="text-xl text-muted-foreground">Everything you need to succeed in one platform</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {benefits.map((benefit) => (
              <Card key={benefit.title} className="bg-slate-700/50 border-slate-600 hover:border-teal-500/50 transition-colors">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-teal-500/20 text-teal-400">
                      <benefit.icon className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl text-white">{benefit.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 dark:text-slate-300">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* What You Get Section — anchor for the "See Platform Demo" CTA */}
      <section id="platform-demo" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">
              Complete Agent Toolkit
            </h2>
          </div>

          <div className="bg-white dark:bg-card rounded-md p-12 border border-slate-600">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                {features.slice(0, 5).map((feature) => (
                  <div key={feature.title} className="flex gap-3 items-start">
                    <Check className="h-6 w-6 text-teal-400 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-white">{feature.title}</h3>
                      <p className="text-muted-foreground text-sm">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                {features.slice(5).map((feature) => (
                  <div key={feature.title} className="flex gap-3 items-start">
                    <Check className="h-6 w-6 text-blue-400 flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-semibold text-white">{feature.title}</h3>
                      <p className="text-muted-foreground text-sm">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-50 dark:bg-muted/50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-6">
            {faqs.map((faq) => (
              <Card key={faq.q} className="bg-slate-700/50 border-slate-600">
                <CardHeader>
                  <CardTitle className="text-lg text-white">{faq.q}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 dark:text-slate-300">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-card">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to Build Your First $10K Month?
          </h2>
          <p className="text-xl text-slate-600 dark:text-slate-300 mb-8">
            Apply now to join the team and start receiving daily warm leads. Get licensed first if you aren't yet — APEX covers the cost when you finish the course.
          </p>
          <Button asChild size="lg" className="bg-white dark:bg-card hover:from-teal-600 hover:to-teal-700 text-white border-0">
            <Link to="/get-licensed" className="gap-2">
              Apply Now <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-border py-12 px-4 sm:px-6 lg:px-8 bg-white dark:bg-card">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-bold text-white mb-4">APEX Financial</h3>
              <p className="text-muted-foreground text-sm">Warm life insurance leads. Built for agents who dial, not browse.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li><Link to="/leads" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Leads</Link></li>
                <li><Link to="/dashboard" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Dashboard</Link></li>
                <li><Link to="/dialer" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Dialer</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li><Link to="/" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">About</Link></li>
                <li><Link to="/contact" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Contact</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li><a href="https://apex-financial.org/privacy" rel="noopener noreferrer" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Privacy</a></li>
                <li><a href="https://apex-financial.org/terms" rel="noopener noreferrer" className="inline-flex min-h-6 items-center hover:text-teal-400 transition">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-border pt-8 flex justify-between items-center text-muted-foreground text-sm">
            <p>&copy; 2026 APEX Financial. All rights reserved.</p>
            <p>APEX — Hold the Standard.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const benefits = [
  {
    icon: TrendingUp,
    title: "Warm Leads Daily",
    description: "Receive warm leads delivered directly to your inbox. No cold calling required. Built for consistent daily follow-up.",
  },
  {
    icon: Award,
    title: "Performance-Based Compensation",
    description: "A comp structure built for serious agents who want to grow into $10,000+ months as they improve and lead.",
  },
  {
    icon: Users,
    title: "Full Training & Support",
    description: "Complete onboarding, live mentorship, and ongoing support from experienced managers and top performers.",
  },
  {
    icon: TrendingUp,
    title: "Work From Anywhere",
    description: "100% remote. Use our cloud-based dialer and tools. Work your own hours. All you need is a computer.",
  },
];

const features = [
  { title: "Lead Distribution", desc: "Fresh lead drops built around consistent follow-up" },
  { title: "Cloud Dialer", desc: "Professional VoIP calling system" },
  { title: "Lead Management", desc: "CRM to track all your applications" },
  { title: "Performance Tracking", desc: "Real-time earnings dashboard" },
  { title: "Manager Support", desc: "Dedicated agent support team" },
  { title: "Compliance Tools", desc: "All licenses and documentation included" },
  { title: "Training Library", desc: "Scripts, videos, and best practices" },
  { title: "Weekly Contests", desc: "Bonuses for top performers" },
];

const faqs = [
  {
    q: "How much can I earn?",
    a: "The system is built for coachable agents who want a real shot at $10,000 months. Results still depend on effort, consistency, skill, and follow-up, but the model is designed around that target.",
  },
  {
    q: "Do I need experience?",
    a: "No. We provide complete training, scripts, and mentorship. Some of our top earners started with no experience. What matters is your commitment.",
  },
  {
    q: "What if I don't make sales?",
    a: "We provide leads at no cost. There's no penalty for not converting leads. You only earn when you close deals. The quality of leads we provide helps you succeed.",
  },
  {
    q: "When do I get paid?",
    a: "Commissions are paid weekly. Your earnings are calculated automatically and transferred to your account every Friday.",
  },
  {
    q: "Can I work part-time?",
    a: "Yes. You set your own schedule. Some agents work 10 hours/week, others 40+. Your leads are always available whenever you want to work.",
  },
  {
    q: "What tools do I need?",
    a: "Just a laptop or computer with internet. We provide everything else: cloud dialer, CRM, lead management tools, and training materials.",
  },
];
