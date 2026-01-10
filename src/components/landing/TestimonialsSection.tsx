import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Quote, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlassCard } from "@/components/ui/glass-card";

const testimonials = [
  {
    name: "Marcus Johnson",
    role: "Senior Agent",
    location: "Atlanta, GA",
    image: null,
    quote: "I came from retail with zero insurance experience. After 6 months at APEX, I'm earning more than I did in 5 years at my old job. The training and leads made all the difference.",
    stats: { income: "$187K", timeframe: "First Year" },
  },
  {
    name: "Sarah Chen",
    role: "Team Manager",
    location: "Los Angeles, CA",
    image: null,
    quote: "APEX gave me the blueprint to success. Now I lead a team of 12 agents and we're on track to do $2M in premium this year. The support system here is unmatched.",
    stats: { income: "$342K", timeframe: "Year Two" },
  },
  {
    name: "David Williams",
    role: "Part-Time Agent",
    location: "Dallas, TX",
    image: null,
    quote: "As a teacher, I needed flexible hours. APEX lets me work evenings and weekends. I've doubled my teacher salary working just 15 hours a week.",
    stats: { income: "$95K", timeframe: "Part-Time" },
  },
  {
    name: "Jennifer Martinez",
    role: "Rising Star Agent",
    location: "Miami, FL",
    image: null,
    quote: "The exclusive leads are a game-changer. I went from struggling to find clients to having more appointments than I can handle. My only regret is not joining sooner.",
    stats: { income: "$156K", timeframe: "First Year" },
  },
  {
    name: "Robert Thompson",
    role: "Regional Director",
    location: "Chicago, IL",
    image: null,
    quote: "I've been in insurance for 20 years and APEX is different. The culture, the compensation, the opportunity—it's the real deal. My team loves it here.",
    stats: { income: "$485K", timeframe: "Year Three" },
  },
];

export function TestimonialsSection() {
  const [current, setCurrent] = useState(0);
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    if (!autoplay) return;
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoplay]);

  const next = () => {
    setAutoplay(false);
    setCurrent((prev) => (prev + 1) % testimonials.length);
  };

  const prev = () => {
    setAutoplay(false);
    setCurrent((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  return (
    <section id="testimonials" className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(168_84%_42%/0.05)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Success Stories"
          title="Hear From Our Agents"
          subtitle="Real stories from real agents who transformed their lives with APEX."
        />

        <div className="max-w-4xl mx-auto mt-16 relative">
          {/* Navigation Buttons */}
          <button
            onClick={prev}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 md:-translate-x-12 z-10 p-2 rounded-full glass hover:bg-primary/20 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={next}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 md:translate-x-12 z-10 p-2 rounded-full glass hover:bg-primary/20 transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* Testimonial Card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              <GlassCard className="p-8 md:p-12">
                <Quote className="h-10 w-10 text-primary/30 mb-6" />
                
                <p className="text-xl md:text-2xl text-foreground mb-8 leading-relaxed">
                  "{testimonials[current].quote}"
                </p>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
                      {testimonials[current].name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-lg">{testimonials[current].name}</div>
                      <div className="text-sm text-muted-foreground">
                        {testimonials[current].role} • {testimonials[current].location}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 md:border-l md:border-border md:pl-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{testimonials[current].stats.income}</div>
                      <div className="text-xs text-muted-foreground">{testimonials[current].stats.timeframe}</div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </AnimatePresence>

          {/* Dots */}
          <div className="flex justify-center gap-2 mt-8">
            {testimonials.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setAutoplay(false);
                  setCurrent(index);
                }}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === current ? "w-8 bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
