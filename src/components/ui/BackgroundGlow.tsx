import { cn } from "@/lib/utils";

interface BackgroundGlowProps {
  accent?: "teal" | "blue" | "amber" | "pink" | "purple";
  className?: string;
  intensity?: "subtle" | "medium" | "strong";
}

const accentColors: Record<string, { blob1: string; blob2: string }> = {
  teal: { blob1: "bg-primary/10", blob2: "bg-emerald-500/8" },
  blue: { blob1: "bg-blue-500/10", blob2: "bg-indigo-500/8" },
  amber: { blob1: "bg-amber-500/10", blob2: "bg-orange-500/8" },
  pink: { blob1: "bg-pink-500/10", blob2: "bg-rose-500/8" },
  purple: { blob1: "bg-purple-500/10", blob2: "bg-violet-500/8" },
};

const intensityScale: Record<string, { size1: string; size2: string; blur: string }> = {
  subtle: { size1: "h-48 w-48", size2: "h-32 w-32", blur: "blur-3xl" },
  medium: { size1: "h-64 w-64", size2: "h-48 w-48", blur: "blur-3xl" },
  strong: { size1: "h-80 w-80", size2: "h-64 w-64", blur: "blur-[80px]" },
};

export function BackgroundGlow({ accent = "teal", className, intensity = "medium" }: BackgroundGlowProps) {
  const colors = accentColors[accent];
  const scale = intensityScale[intensity];

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className={cn("absolute -top-20 -right-20 rounded-full", scale.size1, scale.blur, colors.blob1)} />
      <div className={cn("absolute -bottom-16 -left-16 rounded-full", scale.size2, scale.blur, colors.blob2)} />
    </div>
  );
}
