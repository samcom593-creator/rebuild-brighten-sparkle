import { useState } from "react";
import { SectionHeading } from "@/components/ui/section-heading";
import { VideoTestimonialCard } from "./VideoTestimonialCard";
import { VideoModal } from "./VideoModal";

const videoTestimonials = [
  {
    name: "Marcus Johnson",
    role: "Senior Agent",
    location: "Atlanta, GA",
    quote: "I came from retail with zero insurance experience. After 6 months at APEX, I'm earning more than I did in 5 years at my old job. The training and leads made all the difference.",
    stats: { income: "$187K", timeframe: "First Year" },
    videoDuration: "2:15",
    gradientClass: "from-emerald-600/30 via-emerald-800/40 to-slate-900/60",
  },
  {
    name: "Sarah Chen",
    role: "Team Manager",
    location: "Los Angeles, CA",
    quote: "APEX gave me the blueprint to success. Now I lead a team of 12 agents and we're on track to do $2M in premium this year. The support system here is unmatched.",
    stats: { income: "$342K", timeframe: "Year Two" },
    videoDuration: "3:42",
    gradientClass: "from-teal-600/30 via-emerald-700/40 to-slate-900/60",
  },
  {
    name: "David Williams",
    role: "Part-Time Agent",
    location: "Dallas, TX",
    quote: "As a teacher, I needed flexible hours. APEX lets me work evenings and weekends. I've doubled my teacher salary working just 15 hours a week.",
    stats: { income: "$95K", timeframe: "Part-Time" },
    videoDuration: "1:58",
    gradientClass: "from-cyan-600/30 via-teal-700/40 to-slate-900/60",
  },
  {
    name: "Jennifer Martinez",
    role: "Rising Star Agent",
    location: "Miami, FL",
    quote: "The exclusive leads are a game-changer. I went from struggling to find clients to having more appointments than I can handle. My only regret is not joining sooner.",
    stats: { income: "$156K", timeframe: "First Year" },
    videoDuration: "2:34",
    gradientClass: "from-green-600/30 via-emerald-700/40 to-slate-900/60",
  },
  {
    name: "Robert Thompson",
    role: "Regional Director",
    location: "Chicago, IL",
    quote: "I've been in insurance for 20 years and APEX is different. The culture, the compensation, the opportunity—it's the real deal. My team loves it here.",
    stats: { income: "$485K", timeframe: "Year Three" },
    videoDuration: "4:12",
    gradientClass: "from-emerald-500/30 via-green-700/40 to-slate-900/60",
  },
  {
    name: "Amanda Foster",
    role: "Top Producer",
    location: "Phoenix, AZ",
    quote: "Within my first year, I replaced my corporate salary and now work completely on my own schedule. APEX gave me freedom I never thought possible.",
    stats: { income: "$275K", timeframe: "Year One" },
    videoDuration: "2:48",
    gradientClass: "from-teal-500/30 via-cyan-700/40 to-slate-900/60",
  },
];

type Testimonial = typeof videoTestimonials[number];

export function TestimonialsSection() {
  const [selectedTestimonial, setSelectedTestimonial] = useState<Testimonial | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCardClick = (testimonial: Testimonial) => {
    setSelectedTestimonial(testimonial);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTestimonial(null);
  };

  return (
    <section id="testimonials" className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.05)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Success Stories"
          title="Watch Our Agents Share Their Journey"
          subtitle="Real video testimonials from agents who transformed their lives with APEX."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
          {videoTestimonials.map((testimonial, index) => (
            <VideoTestimonialCard
              key={testimonial.name}
              {...testimonial}
              onClick={() => handleCardClick(testimonial)}
              index={index}
            />
          ))}
        </div>
      </div>

      <VideoModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        testimonial={selectedTestimonial}
      />
    </section>
  );
}
