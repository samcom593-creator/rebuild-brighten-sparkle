import { Quote } from "lucide-react";

const TESTIMONIALS = [
  {
    name: "Alex",
    state: "TX",
    carrier: "Guarantee Trust Life",
    quote: "Literally within two days I already did almost $4,000–$5,000 production. The systems are there.",
    metric: "$5K in 2 days",
    photo: "https://api.dicebear.com/9.x/initials/svg?seed=Alex&backgroundColor=10b981",
  },
  {
    name: "Moody",
    state: "TX",
    carrier: "American Home Life",
    quote: "Sam told me to do $5K a week. I did it in 2 days. Sitting on my ass reading the script.",
    metric: "$5K week 1",
    photo: "https://api.dicebear.com/9.x/initials/svg?seed=Moody&backgroundColor=06b6d4",
  },
  {
    name: "Chukwudi",
    state: "GA",
    carrier: "Mutual of Omaha",
    quote: "Just sticking to the script. Sam gave us a script and told us stick to it and you'll close.",
    metric: "$34K production",
    photo: "https://api.dicebear.com/9.x/initials/svg?seed=Chukwudi&backgroundColor=f59e0b",
  },
];

export function Testimonials() {
  return (
    <section className="relative py-24 md:py-32 bg-gradient-to-b from-transparent via-zinc-950/50 to-transparent">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="text-center mb-16 landing-fade-up">
          <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-[0.3em] font-display font-semibold">
            Real agents · real receipts
          </p>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl tracking-tight">
            <span className="brand-gradient">Numbers</span> not slogans
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={t.name}
              className="landing-fade-up relative rounded-2xl border border-primary/20 bg-card/60 backdrop-blur-xl p-6 sm:p-7 hover:border-primary/40 hover:-translate-y-1 transition-all duration-300 shadow-lg hover:shadow-[0_20px_50px_hsl(168_80%_50%/0.15)]"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <Quote className="h-7 w-7 text-primary/40 mb-4" />
              <p className="text-base sm:text-lg leading-relaxed mb-6 text-foreground/95">
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3 pt-4 border-t border-border/40">
                <img src={t.photo} alt={t.name} className="h-12 w-12 rounded-full ring-2 ring-primary/30" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground">{t.name} · {t.state}</p>
                  <p className="text-xs text-muted-foreground">Writing {t.carrier}</p>
                </div>
                <span className="text-sm font-display font-bold text-primary tabular-nums">{t.metric}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
