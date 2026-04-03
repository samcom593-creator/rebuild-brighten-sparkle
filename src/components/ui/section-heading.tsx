import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface SectionHeadingProps {
  badge?: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
  className?: string;
}

export const SectionHeading = forwardRef<HTMLDivElement, SectionHeadingProps>(
  ({ badge, title, subtitle, centered = true, className }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn("space-y-4", centered && "text-center", className)}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5 }}
      >
        {badge && (
          <motion.span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#22d3a5]/10 text-[#22d3a5] border border-[#22d3a5]/20"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            {badge}
          </motion.span>
        )}
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-[#f1f5f9] font-display">
          {title}
        </h2>
        {subtitle && (
          <p className="text-lg md:text-xl text-[#94a3b8] max-w-3xl mx-auto">
            {subtitle}
          </p>
        )}
      </motion.div>
    );
  }
);

SectionHeading.displayName = "SectionHeading";
