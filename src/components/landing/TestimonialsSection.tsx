import { motion } from "framer-motion";
import { useState } from "react";
import { Play } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

// Lazy YouTube + dark poster fallback — fixes PL-002 "white VSL screen" on
// the landing. Eager iframe was painting white while the YouTube SDK loaded.
// Same pattern as HeroSection's LazyYouTube.
function LazyYouTubeFrame({ videoId, title }: { videoId: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative aspect-video rounded-lg overflow-hidden bg-black group">
      {loaded ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          aria-label={`Play ${title}`}
          className="absolute inset-0 w-full h-full flex items-center justify-center"
        >
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt={title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span className="absolute inset-0 bg-black/40 group-hover:bg-black/55 transition-colors" />
          <span className="relative h-16 w-16 rounded-full bg-primary/95 flex items-center justify-center shadow-[0_0_40px_hsl(168_80%_50%/0.55)] group-hover:scale-110 transition-transform">
            <Play className="h-8 w-8 text-primary-foreground fill-primary-foreground ml-1" />
          </span>
        </button>
      )}
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-24 relative overflow-hidden bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(168_84%_42%/0.04)_0%,transparent_50%)]" />

      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Success Story"
          title="Watch How APEX Changed His Life"
          subtitle="Real results from a real agent who transformed his career with APEX."
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mt-12 max-w-4xl mx-auto"
        >
          <div className="p-2 md:p-3 bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] rounded-xl">
            <LazyYouTubeFrame videoId="YmlLSIwfGdE" title="APEX Success Story" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
