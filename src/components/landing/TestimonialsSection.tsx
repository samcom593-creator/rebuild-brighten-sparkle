import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";

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
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src="https://www.youtube.com/embed/YmlLSIwfGdE"
                title="APEX Success Story"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
