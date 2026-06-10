import { useState } from "react";
import { motion } from "framer-motion";
import { Crown, CheckCircle2, Calendar, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";
import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  SCHEDULING_LINKS,
  resolveLicensedScheduling,
  getCalendlyHostName,
} from "@/lib/apexConfig";

/**
 * Phase 12: Calendly Strategy
 * Centralized booking page with license-based routing.
 * Licensed → inline embed (keeps user on-site)
 * Unlicensed → inline embed (different calendar)
 */
const SAMUEL_JAMES_CALENDLY = SCHEDULING_LINKS.samLicensed;

export default function ScheduleCall() {
  usePageTitle("Schedule a Call · APEX Financial");
  const [hasLicense, setHasLicense] = useState<boolean | null>(null);
  const [leaderQualified, setLeaderQualified] = useState<boolean | null>(null);

  // Unlicensed visitors are blocked from booking — they must enroll in
  // pre-licensing first. Sam (2026-05-18 punch list, PL-001): "make it so
  // that you tell them. They cannot schedule a call unless they have at
  // least finished the prelicensing course."
  if (hasLicense === false) {
    return (
      <div className="min-h-screen bg-background">
        <nav className="fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link to="/" className="flex items-center gap-2">
                <Crown className="h-8 w-8 text-primary" />
                <span className="text-xl font-bold gradient-text">APEX Financial</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => { setHasLicense(null); setLeaderQualified(null); }} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </div>
          </div>
        </nav>
        <main className="pt-24 pb-16 px-4">
          <div className="max-w-xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <GlassCard className="p-8 text-center">
                <h1 className="text-2xl font-bold mb-3">Finish Pre-Licensing First</h1>
                <p className="text-muted-foreground mb-6">
                  We reserve calls for applicants who are licensed or actively
                  finishing pre-licensing. Start your course and we'll see you
                  on the other side.
                </p>
                <div className="flex flex-col gap-3">
                  <Link to="/apply">
                    <Button size="lg" className="w-full gap-2 btn-press">
                      Start Application <CheckCircle2 className="h-5 w-5" />
                    </Button>
                  </Link>
                  <Link to="/get-licensed">
                    <Button size="lg" variant="outline" className="w-full">
                      What does licensing involve?
                    </Button>
                  </Link>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }
  if (hasLicense === true && leaderQualified === null) {
    return (
      <div className="min-h-screen bg-background">
        <nav className="fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link to="/" className="flex items-center gap-2">
                <Crown className="h-8 w-8 text-primary" />
                <span className="text-xl font-bold gradient-text">APEX Financial</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => { setHasLicense(null); setLeaderQualified(null); }} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </div>
          </div>
        </nav>

        <main className="pt-24 pb-16 px-4">
          <div className="max-w-xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <GlassCard className="p-8 text-center">
                <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 animate-pulse-glow">
                  <Calendar className="h-8 w-8 text-primary-foreground" />
                </div>
                <h1 className="text-2xl font-bold mb-3">Who are we booking you with?</h1>
                <p className="text-muted-foreground mb-6">
                  Samuel James calls are reserved for licensed leaders with at
                  least five agents or $50,000+ in monthly production.
                </p>
                <div className="grid gap-3">
                  <Button size="lg" className="w-full gap-2 btn-press" onClick={() => setLeaderQualified(true)}>
                    Yes, I meet that threshold <CheckCircle2 className="h-5 w-5" />
                  </Button>
                  <Button size="lg" variant="outline" className="w-full gap-2 btn-press" onClick={() => setLeaderQualified(false)}>
                    Not yet
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }

  if (hasLicense === true) {
    // v9 wave-C: KJ's URL is still placeholder → resolver returns Sam's link
    // and fires the idempotent Telegram nag. Once Sam pastes KJ's real URL
    // into SCHEDULING_LINKS.kjLicensed the resolver routes there automatically.
    const resolved = leaderQualified
      ? { url: SAMUEL_JAMES_CALENDLY, hostName: getCalendlyHostName(SAMUEL_JAMES_CALENDLY), fallback: false }
      : resolveLicensedScheduling(true);
    const calendlyUrl = resolved.url;
    return (
      <div className="min-h-screen bg-background">
        <nav className="fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link to="/" className="flex items-center gap-2">
                <Crown className="h-8 w-8 text-primary" />
                <span className="text-xl font-bold gradient-text">APEX Financial</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => setLeaderQualified(null)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </div>
          </div>
        </nav>

        <main className="pt-20 pb-8 px-4">
          <div className="max-w-3xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <GlassCard className="p-4 mb-4">
                <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="font-bold text-sm">
                      {leaderQualified ? "Samuel James strategy call" : "Licensed onboarding call"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Booking with: <span className="text-foreground font-medium">{resolved.hostName}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {leaderQualified
                        ? "Reserved for 5+ agents or $50K+ monthly production"
                        : "Pick a time with the onboarding strategist"}
                    </p>
                  </div>
                </div>
              </GlassCard>
              <GlassCard className="overflow-hidden">
                <CalendlyEmbed url={calendlyUrl} className="rounded-xl" />
              </GlassCard>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-strong border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <Crown className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold gradient-text">APEX Financial</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16 px-4">
        <div className="max-w-xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <GlassCard className="p-8 text-center">
              <div className="mb-6">
                <div className="h-16 w-16 mx-auto rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 animate-pulse-glow">
                  <Calendar className="h-8 w-8 text-primary-foreground" />
                </div>
                <h1 className="text-2xl font-bold mb-2">Schedule Your Call</h1>
                <p className="text-muted-foreground">One quick question before we connect you with the right team member</p>
              </div>

              <div className="space-y-4 mb-8">
                <div className="p-4 rounded-lg border-2 border-primary/20 bg-primary/5">
                  <h2 className="font-semibold text-lg mb-2">Do you currently have your life insurance license?</h2>
                  <p className="text-sm text-muted-foreground">This helps us match you with the right advisor for your situation</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="flex-1 gap-2 btn-press" onClick={() => setHasLicense(true)}>
                  <CheckCircle2 className="h-5 w-5" /> Yes, I'm Licensed
                </Button>
                <Button size="lg" variant="outline" className="flex-1 gap-2 btn-press" onClick={() => setHasLicense(false)}>
                  No, Not Yet
                </Button>
              </div>

              <p className="text-xs text-muted-foreground mt-6">If you're not licensed yet, you'll be routed to start your pre-licensing first — calls are reserved for licensed (or in-progress) applicants.</p>
            </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <GlassCard className="mt-8 p-6">
              <h3 className="font-semibold mb-4 text-center">What You'll Get at Apex:</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {["Unlimited warm leads daily", "$10K+ starting income", "Full training program", "Equity partnership", "Work from anywhere", "CRM access included"].map((benefit, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="text-muted-foreground">{benefit}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
