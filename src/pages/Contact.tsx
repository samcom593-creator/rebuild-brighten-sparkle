import { Calendar, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Contact() {
  usePageTitle("Contact APEX Financial");

  return (
    <div className="min-h-screen bg-[#030712] px-4 py-16 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300">APEX Financial</p>
          <h1 className="text-4xl font-bold md:text-5xl">Contact APEX</h1>
          <p className="mx-auto max-w-2xl text-base text-slate-300 md:text-lg">
            Reach the right person fast. For recruiting, licensing, onboarding, or general questions,
            use the option below that matches what you need.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <GlassCard className="border-slate-700/60 bg-slate-900/70 p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300">
              <Calendar className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">Book a Call</h2>
            <p className="mt-2 text-sm text-slate-300">
              Best for recruiting questions, licensing help, or next-step guidance.
            </p>
            <Button asChild className="mt-5 w-full bg-teal-500 hover:bg-teal-400 text-slate-950">
              <Link to="/schedule-call">Schedule a Call</Link>
            </Button>
          </GlassCard>

          <GlassCard className="border-slate-700/60 bg-slate-900/70 p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
              <Mail className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">Email</h2>
            <p className="mt-2 text-sm text-slate-300">
              For documents, support requests, and anything that needs a written follow-up.
            </p>
            <a
              href="mailto:info@apex-financial.org"
              className="mt-5 inline-flex w-full items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:border-teal-400 hover:text-teal-300"
            >
              info@apex-financial.org
            </a>
          </GlassCard>

          <GlassCard className="border-slate-700/60 bg-slate-900/70 p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
              <Phone className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">Call or Text</h2>
            <p className="mt-2 text-sm text-slate-300">
              Fastest path when you already know what you need and want a direct answer.
            </p>
            <a
              href="tel:+14697676068"
              className="mt-5 inline-flex w-full items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:border-teal-400 hover:text-teal-300"
            >
              (469) 767-6068
            </a>
          </GlassCard>
        </div>

        <GlassCard className="border-slate-700/60 bg-slate-900/70 p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-slate-800 p-2 text-slate-300">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Nationwide Opportunity</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                APEX works with agents across the United States. If you are licensed, unlicensed,
                brand new, or already producing, we will point you to the right next step quickly.
              </p>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
