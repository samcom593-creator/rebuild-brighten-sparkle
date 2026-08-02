import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CheckCircle2, ArrowRight, Crown, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * /storefront — Stripe Payment Link redirect target.
 *
 * 2026-04-29: every Stripe Payment Link in `dialer_payment_link.md`
 * (Gold + Platinum + others) redirects to
 * `apex-financial.org/storefront?paid=1` after checkout. That URL was
 * returning 404. This page renders a celebratory confirmation when
 * `?paid=1` is present and a clean offer-list otherwise.
 */
const SKUS = [
  {
    name: "Gold Leads + Dialer",
    price: "$250 / week",
    blurb: "Quality leads ≤30 days old · weekly drop · ReadyMode dialer included",
    href: "https://buy.stripe.com/dRm28q56XbDN7uH8w97ss02",
  },
  {
    name: "Platinum Vet Leads + Dialer",
    price: "$500 / week",
    blurb: "Hottest leads from this week · first-access · ReadyMode dialer",
    href: "https://buy.stripe.com/28E8wOfLB7nx8yLcMp7ss03",
  },
];

export default function Storefront() {
  usePageTitle("APEX Storefront · Subscribe");
  const [params] = useSearchParams();
  const paid = params.get("paid") === "1";
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (paid) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 4000);
      return () => clearTimeout(t);
    }
  }, [paid]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-white">
      <header className="border-b border-slate-200 dark:border-slate-800/60">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <Crown className="h-6 w-6 text-emerald-400" /> APEX Financial
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12 md:py-16">
        {paid ? (
          <Card className="border-emerald-500/40 bg-white dark:bg-slate-900 reveal">
            <CardHeader className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
                <CheckCircle2 className="h-9 w-9 text-emerald-400" />
              </div>
              <CardTitle className="text-3xl font-extrabold text-white">Payment received 🎉</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-center text-slate-600 dark:text-slate-300">
              <p>
                Welcome aboard. Your subscription is active — Sam will reach out within the next business hour to onboard
                you onto the dialer + drop your first batch of leads.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <Button asChild className="bg-emerald-500 hover:bg-emerald-600">
                  <Link to="/dashboard" className="gap-2">
                    Go to Dashboard <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <a href="tel:+14697676068"><Phone className="h-4 w-4" /> Call Sam</a>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <a href="mailto:sam.com593@gmail.com"><Mail className="h-4 w-4" /> Email Sam</a>
                </Button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 pt-3">
                Receipt was emailed to the address you used at checkout. If you don't see it, check spam.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">APEX Storefront</h1>
              <p className="text-slate-400 mt-3 text-lg">Pick the package that matches your hustle.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {SKUS.map((s) => (
                <Card key={s.name} className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-emerald-500/50 transition-colors">
                  <CardHeader>
                    <CardTitle className="text-xl text-white">{s.name}</CardTitle>
                    <div className="text-2xl font-extrabold text-emerald-400 pt-1">{s.price}</div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-400 mb-5">{s.blurb}</p>
                    <Button asChild className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="gap-2">
                        Subscribe <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>

      {showConfetti && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {/* Lightweight confetti via CSS */}
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              // stable-key-allow:decorative-confetti-particle-fixed-length
              key={i}
              className="absolute w-2 h-2 rounded-sm animate-fall"
              // palette-allow:storefront-confetti-particle-animation — 4-color falling-particle effect on gift purchase
              style={{
                left: `${Math.random() * 100}%`,
                top: `-${Math.random() * 20 + 10}%`,
                background: ["#e8bb2b", "#a78bfa", "#fbbf24", "#3b82f6"][i % 4],
                animationDelay: `${Math.random() * 0.6}s`,
                animationDuration: `${1.4 + Math.random() * 1.6}s`,
              }}
            />
          ))}
          <style>{`@keyframes fall { to { transform: translateY(110vh) rotate(360deg); } } .animate-fall { animation: fall linear forwards; }`}</style>
        </div>
      )}
    </div>
  );
}
