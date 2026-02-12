import { motion } from "framer-motion";
import { Phone, Filter, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SourceFilter = "all" | "aged_leads" | "applications";
export type LicenseFilter = "all" | "licensed" | "unlicensed";
export type StatusFilter = "new" | "no_pickup" | "contacted";
export type ProgressFilter = "all" | "course_purchased" | "passed_test" | "waiting_on_license";
export type SortOrder = "newest_first" | "oldest_first";

interface CallCenterFiltersProps {
  sourceFilter: SourceFilter;
  licenseFilter: LicenseFilter;
  statusFilter: StatusFilter;
  progressFilter: ProgressFilter;
  sortOrder: SortOrder;
  onSourceChange: (value: SourceFilter) => void;
  onLicenseChange: (value: LicenseFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onProgressChange: (value: ProgressFilter) => void;
  onSortOrderChange: (value: SortOrder) => void;
  onStart: () => void;
  disabled?: boolean;
  className?: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
  },
} as const;

export function CallCenterFilters({
  sourceFilter,
  licenseFilter,
  statusFilter,
  progressFilter,
  sortOrder,
  onSourceChange,
  onLicenseChange,
  onStatusChange,
  onProgressChange,
  onSortOrderChange,
  onStart,
  disabled,
  className,
}: CallCenterFiltersProps) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn("container max-w-2xl mx-auto py-8 px-4", className)}
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div
          className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30 mb-4"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          {/* Floating animation for phone icon */}
          <motion.div
            animate={{
              y: [0, -4, 0],
              rotate: [0, 5, -5, 0],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Phone className="h-10 w-10 text-primary" />
          </motion.div>

          {/* Sparkle decoration */}
          <motion.div
            className="absolute -top-1 -right-1"
            animate={{ rotate: [0, 20, -20, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
          >
            <Sparkles className="h-4 w-4 text-yellow-400" />
          </motion.div>

          {/* Pulse ring */}
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-primary/30"
            animate={{ scale: [1, 1.15, 1.15], opacity: [0.5, 0, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        </motion.div>

        <motion.h1
          variants={itemVariants}
          className="text-3xl font-bold mb-2 bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text"
        >
          Call Center
        </motion.h1>
        <motion.p variants={itemVariants} className="text-muted-foreground">
          Process leads one at a time with AI-powered note taking
        </motion.p>
      </motion.div>

      {/* Filters Card */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 space-y-6 relative overflow-hidden group">
          {/* Hover glow effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          />

          <motion.div
            variants={itemVariants}
            className="flex items-center gap-2 text-foreground font-semibold relative z-10"
          >
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Filter className="h-4 w-4 text-primary" />
            </motion.div>
            Configure Filters
          </motion.div>

          <div className="grid gap-5 relative z-10">
            {[
              {
                label: "Lead Source",
                value: sourceFilter,
                onChange: onSourceChange,
                options: [
                  { value: "all", label: "All Sources" },
                  { value: "aged_leads", label: "Aged Leads" },
                  { value: "applications", label: "New Drip-Ins" },
                ],
              },
              {
                label: "License Status",
                value: licenseFilter,
                onChange: onLicenseChange,
                options: [
                  { value: "all", label: "All" },
                  { value: "licensed", label: "Licensed" },
                  { value: "unlicensed", label: "Unlicensed" },
                ],
              },
              {
                label: "Lead Status",
                value: statusFilter,
                onChange: onStatusChange,
                options: [
                  { value: "new", label: "New / Uncontacted" },
                  { value: "no_pickup", label: "No Pickup (Retry)" },
                  { value: "contacted", label: "Contacted" },
                ],
              },
              {
                label: "License Progress",
                value: progressFilter,
                onChange: onProgressChange,
                options: [
                  { value: "all", label: "All Progress" },
                  { value: "course_purchased", label: "Course Purchased" },
                  { value: "passed_test", label: "Passed Test" },
                  { value: "waiting_on_license", label: "Waiting on License" },
                ],
              },
              {
                label: "Sort Order",
                value: sortOrder,
                onChange: onSortOrderChange,
                options: [
                  { value: "oldest_first", label: "Late Opt-Ins First (Oldest)" },
                  { value: "newest_first", label: "New Opt-Ins First (Newest)" },
                ],
              },
            ].map((filter, index) => (
              <motion.div
                key={filter.label}
                variants={itemVariants}
                custom={index}
                whileHover={{ x: 4 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                <label className="text-sm font-medium mb-2 block text-muted-foreground">
                  {filter.label}
                </label>
                <Select value={filter.value} onValueChange={filter.onChange as (v: string) => void}>
                  <SelectTrigger className="bg-background/50 border-border/50 hover:border-primary/50 transition-colors focus:ring-2 focus:ring-primary/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filter.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </motion.div>
            ))}
          </div>

          <motion.div variants={itemVariants} className="relative z-10">
            <motion.div
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <Button
                onClick={onStart}
                disabled={disabled}
                size="lg"
                className="w-full relative overflow-hidden bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20 group"
              >
                {/* Shimmer effect */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                  animate={{ translateX: ["−100%", "100%"] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                />

                <Phone className="h-5 w-5 mr-2 group-hover:rotate-12 transition-transform" />
                Start Calling
              </Button>
            </motion.div>
          </motion.div>
        </GlassCard>
      </motion.div>

      {/* Keyboard Hints */}
      <motion.p
        variants={itemVariants}
        className="text-xs text-muted-foreground text-center mt-6"
      >
        Keyboard:{" "}
        <motion.span
          className="text-foreground/70"
          whileHover={{ color: "hsl(var(--primary))" }}
        >
          R
        </motion.span>{" "}
        record •{" "}
        <motion.span
          className="text-foreground/70"
          whileHover={{ color: "hsl(var(--primary))" }}
        >
          1-3
        </motion.span>{" "}
        actions •{" "}
        <motion.span
          className="text-foreground/70"
          whileHover={{ color: "hsl(var(--primary))" }}
        >
          N
        </motion.span>{" "}
        skip •{" "}
        <motion.span
          className="text-foreground/70"
          whileHover={{ color: "hsl(var(--primary))" }}
        >
          ESC
        </motion.span>{" "}
        exit
      </motion.p>
    </motion.div>
  );
}
