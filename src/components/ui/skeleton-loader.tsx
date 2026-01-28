import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";

interface SkeletonLoaderProps {
  className?: string;
  variant?: "card" | "text" | "circle" | "page";
}

export function SkeletonLoader({ className, variant = "card" }: SkeletonLoaderProps) {
  if (variant === "page") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="relative">
            <Crown className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
            <div className="absolute inset-0 h-12 w-12 mx-auto rounded-full bg-primary/20 blur-xl animate-pulse" />
          </div>
          <p className="text-muted-foreground font-medium text-sm">
            Powered by Apex
          </p>
        </motion.div>
      </div>
    );
  }

  if (variant === "circle") {
    return (
      <div
        className={cn(
          "rounded-full bg-muted animate-pulse",
          className
        )}
      />
    );
  }

  if (variant === "text") {
    return (
      <div
        className={cn(
          "h-4 rounded bg-muted animate-pulse",
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg bg-muted/50 animate-pulse",
        className
      )}
    />
  );
}

// Card skeleton with consistent styling
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("p-6 rounded-xl glass space-y-4", className)}>
      <div className="flex items-center gap-3">
        <SkeletonLoader variant="circle" className="h-10 w-10" />
        <div className="space-y-2 flex-1">
          <SkeletonLoader variant="text" className="w-24" />
          <SkeletonLoader variant="text" className="w-16 h-3" />
        </div>
      </div>
      <SkeletonLoader className="h-20" />
    </div>
  );
}

// Dashboard skeleton for page loads
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 animate-fade-in">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <SkeletonLoader variant="text" className="h-8 w-48" />
      </div>

      {/* Stats row skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-xl bg-muted/30 space-y-2">
            <SkeletonLoader variant="text" className="w-16 h-3" />
            <SkeletonLoader variant="text" className="w-24 h-8" />
          </div>
        ))}
      </div>

      {/* Two column layout skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardSkeleton className="h-64" />
        <CardSkeleton className="h-64" />
      </div>
    </div>
  );
}
