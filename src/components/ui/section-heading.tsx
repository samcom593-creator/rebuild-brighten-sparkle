import { forwardRef } from "react";
import { cn } from "@/lib/utils";

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
      <div
        ref={ref}
        className={cn("space-y-4 landing-fade-up", centered && "text-center", className)}
      >
        {badge && (
          <span
            className="landing-scale-in landing-delay-100 inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#22d3a5]/10 text-[#22d3a5] border border-[#22d3a5]/20"
          >
            {badge}
          </span>
        )}
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-[#f1f5f9] font-display">
          {title}
        </h2>
        {subtitle && (
          <p className="text-lg md:text-xl text-[#94a3b8] max-w-3xl mx-auto">
            {subtitle}
          </p>
        )}
      </div>
    );
  }
);

SectionHeading.displayName = "SectionHeading";
