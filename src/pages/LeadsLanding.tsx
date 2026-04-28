import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  Zap,
  Users,
  Clock,
  Star,
  Phone,
  TrendingUp,
  ShieldCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PACKAGES = [
  {
    id: "gold",
    name: "Gold Leads",
    tagline: "Pipeline builder",
    description:
      "Quality leads 30 days old or less. Pre-qualified prospects so you book conversations day one.",
    features: [
      "Unlimited leads",
      "≤30 days old",
      "Pre-qualified prospects",
      "ReadyMode dialer included",
      "Weekly delivery",
    ],
    price: 250,
    popular: false,
    paymentUrl: "https://buy.stripe.com/dRm28q56XbDN7uH8w97ss02",
    accent: "from-amber-500/30 via-amber-500/10 to-transparent",
    glow: "bg-amber-500/40",
  },
  {
    id: "platinum",
    name: "Platinum Vet Leads",
    tagline: "Hottest in market",
    description:
      "Fresh leads logged this week. The exact same prospects our top closers are calling — first-priority access.",
    features: [
      "Unlimited leads",
      "Logged this week (≤7 days)",
      "Highest conversion rates",
      "ReadyMode dialer included",
      "First-priority weekly drop",
    ],
    price: 500,
    popular: true,
    paymentUrl: "https://buy.stripe.com/28E8wOfLB7nx8yLcMp7ss03",
    accent: "from-violet-500/30 via-fuchsia-500/10 to-transparent",
    glow: "bg-violet-500/40",
  },
];

function getNextSundayMidnightCST(): Date {
  const now = new Date();
  const cstOffset = -6 * 60;
  const utcOffset = now.getTimezoneOffset();
  const cstNow = new Date(now.getTime() + (cstOffset - utcOffset) * 60000);
  const daysUntilSunday = (7 - cstNow.getDay()) % 7 || 7;
  const next = new Date(cstNow);
  next.setDate(next.getDate() + daysUntilSunday);
  next.setHours(0, 0, 0, 0);
  return new Date(next.getTime() - (cstOffset - utcOffset) * 60000);
}

function useCountdown(target: Date) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const calc = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
      return {
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff / 3600000) % 24),
        m: Math.floor((diff / 60000) % 60),
        s: Math.floor((diff / 1000) % 60),
      };
    };
    setT(calc());
    const i = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(i);
  }, [target]);
  return t;
}

function FloatingOrb({
  className,
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={cn(
        "absolute rounded-full blur-3xl pointer-events-none",
        className
      )}
      animate={{
        x: [0, 30, -20, 0],
        y: [0, -40, 20, 0],
        scale: [1, 1.15, 0.95, 1],
      }}
      transition={{
        duration: 18,
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
    />
  );
}

function HeroOrb3D() {
  // Pure-CSS pseudo-3D: stacked rotating gradient rings + floating spheres.
  return (
    <div className="relative w-full aspect-square max-w-md mx-auto perspective-[1200px]">
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 90deg, #f59e0b, #ec4899, #8b5cf6, #06b6d4, #f59e0b)",
          filter: "blur(60px)",
          opacity: 0.5,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute inset-8 rounded-full border-2 border-white/20 backdrop-blur-md bg-white/5"
        animate={{ rotateY: 360, rotateX: 15 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        style={{ transformStyle: "preserve-3d" }}
      />
      <motion.div
        className="absolute inset-16 rounded-full border border-white/10 backdrop-blur-sm bg-gradient-to-br from-white/10 to-transparent"
        animate={{ rotateY: -360, rotateX: -10 }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
        style={{ transformStyle: "preserve-3d" }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 shadow-[0_0_80px_rgba(236,72,153,0.6)]"
        animate={{
          y: [-10, 10, -10],
          scale: [1, 1.05, 1],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-8 right-8 w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_30px_rgba(6,182,212,0.6)]"
        animate={{ y: [0, -15, 0], x: [0, 10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-12 left-12 w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 shadow-[0_0_30px_rgba(251,191,36,0.6)]"
        animate={{ y: [0, 10, 0], x: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />
    </div>
  );
}

export default function LeadsLanding() {
  const nextSunday = useMemo(() => getNextSundayMidnightCST(), []);
  const c = useCountdown(nextSunday);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-background via-background to-background text-foreground">
      {/* Animated background orbs */}
      <FloatingOrb className="w-[500px] h-[500px] bg-amber-500/20 -top-32 -left-32" />
      <FloatingOrb className="w-[600px] h-[600px] bg-violet-500/20 top-1/3 -right-40" delay={4} />
      <FloatingOrb className="w-[400px] h-[400px] bg-cyan-500/15 bottom-0 left-1/3" delay={8} />

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-8 py-12 md:py-20 space-y-16">
        {/* HERO */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center"
        >
          <div className="space-y-6">
            <Badge className="gap-1.5 px-3 py-1 bg-primary/10 border border-primary/30 text-primary">
              <Flame className="h-3.5 w-3.5" />
              APEX Financial Empire — Lead Drop Live
            </Badge>
            <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-[1.05]">
              Stop chasing.
              <br />
              <span className="bg-gradient-to-r from-amber-400 via-pink-500 to-violet-500 bg-clip-text text-transparent">
                Start closing.
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
              Premium life insurance leads + ReadyMode dialer in one weekly
              activation. Pick your tier, hit the button, and your dialer
              fires up before your coffee finishes.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/50 backdrop-blur border border-border/50">
                <Users className="h-4 w-4 text-amber-400" />
                <span>1,400+ active agents</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/50 backdrop-blur border border-border/50">
                <Phone className="h-4 w-4 text-cyan-400" />
                <span>Dialer included</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/50 backdrop-blur border border-border/50">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>
          <HeroOrb3D />
        </motion.div>

        {/* COUNTDOWN */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <Card className="p-6 md:p-8 bg-card/40 backdrop-blur-xl border-border/50 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-violet-500/5" />
            <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30">
                  <Clock className="h-7 w-7 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Next Drop
                  </p>
                  <p className="text-xl md:text-2xl font-bold">
                    Sunday 12:00 AM CST
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { v: c.d, l: "Days" },
                  { v: c.h, l: "Hrs" },
                  { v: c.m, l: "Min" },
                  { v: c.s, l: "Sec" },
                ].map((x) => (
                  <div
                    key={x.l}
                    className="text-center min-w-[60px] p-3 rounded-xl bg-background/60 backdrop-blur border border-border/50"
                  >
                    <span className="block text-2xl md:text-3xl font-bold tabular-nums">
                      {String(x.v).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {x.l}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* PACKAGES */}
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center space-y-3"
          >
            <h2 className="text-3xl md:text-4xl font-bold">
              Pick your tier. Activate weekly.
            </h2>
            <p className="text-muted-foreground">
              One subscription. Both tiers include the ReadyMode dialer at no
              extra charge.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PACKAGES.map((pkg, idx) => (
              <motion.div
                key={pkg.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: idx * 0.15 }}
              >
                <Card
                  className={cn(
                    "relative overflow-hidden p-6 md:p-8 h-full bg-card/50 backdrop-blur-xl border transition-all duration-300 hover:scale-[1.02] hover:border-primary/50",
                    pkg.popular ? "border-primary/40" : "border-border/50"
                  )}
                >
                  <div
                    className={cn(
                      "absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-60",
                      pkg.glow
                    )}
                  />
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none",
                      pkg.accent
                    )}
                  />
                  {pkg.popular && (
                    <Badge className="absolute top-4 right-4 gap-1 bg-primary text-primary-foreground">
                      <Star className="h-3 w-3" fill="currentColor" />
                      Most Popular
                    </Badge>
                  )}
                  <div className="relative space-y-6">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                        {pkg.tagline}
                      </p>
                      <h3 className="text-2xl md:text-3xl font-bold">
                        {pkg.name}
                      </h3>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      {pkg.description}
                    </p>
                    <ul className="space-y-2.5">
                      {pkg.features.map((f) => (
                        <li
                          key={f}
                          className="flex items-start gap-2.5 text-sm"
                        >
                          <div className="mt-0.5 p-0.5 rounded-full bg-primary/15">
                            <Zap className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-5xl font-black tabular-nums">
                          ${pkg.price}
                        </span>
                        <span className="text-muted-foreground">/week</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Auto-renews weekly • Cancel anytime
                      </p>
                    </div>
                    <Button
                      asChild
                      size="lg"
                      className={cn(
                        "w-full h-12 text-base font-semibold gap-2 group",
                        pkg.popular &&
                          "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500"
                      )}
                    >
                      <a
                        href={pkg.paymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Activate {pkg.name}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </a>
                    </Button>
                    <p className="text-[11px] text-center text-muted-foreground">
                      Card • Apple Pay • Google Pay • Cash App • Link • ACH
                    </p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        {/* TRUST ROW */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {[
            {
              icon: TrendingUp,
              title: "Built for closers",
              body: "Same lead source our top earners use to write 5-figure weeks.",
            },
            {
              icon: Sparkles,
              title: "Dialer + leads, one tap",
              body: "Your ReadyMode subscription is bundled. No second invoice.",
            },
            {
              icon: ShieldCheck,
              title: "Cancel anytime",
              body: "Hit pause when you're at IUL trainings or family time. No hassle.",
            },
          ].map((it, i) => (
            <Card
              key={i}
              className="p-6 bg-card/40 backdrop-blur-xl border-border/50 space-y-3"
            >
              <div className="p-2.5 inline-block rounded-xl bg-primary/15">
                <it.icon className="h-5 w-5 text-primary" />
              </div>
              <h4 className="font-bold text-lg">{it.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {it.body}
              </p>
            </Card>
          ))}
        </motion.div>

        {/* FOOTER */}
        <div className="text-center pt-8 pb-4 border-t border-border/30 space-y-2">
          <p className="text-sm text-muted-foreground">
            Need a different payment method? DM Sam directly.
          </p>
          <p className="text-xs text-muted-foreground/70">
            APEX Financial Empire LLC · Powered by Stripe
          </p>
        </div>
      </div>
    </div>
  );
}
