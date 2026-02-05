import { motion } from "framer-motion";
import {
  Phone,
  Filter,
} from "lucide-react";
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

interface CallCenterFiltersProps {
  sourceFilter: SourceFilter;
  licenseFilter: LicenseFilter;
  statusFilter: StatusFilter;
  onSourceChange: (value: SourceFilter) => void;
  onLicenseChange: (value: LicenseFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onStart: () => void;
  className?: string;
}

export function CallCenterFilters({
  sourceFilter,
  licenseFilter,
  statusFilter,
  onSourceChange,
  onLicenseChange,
  onStatusChange,
  onStart,
  className,
}: CallCenterFiltersProps) {
  return (
    <div className={cn("container max-w-2xl mx-auto py-8 px-4", className)}>
      {/* Header */}
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30 mb-4"
        >
          <Phone className="h-10 w-10 text-primary" />
        </motion.div>
        <motion.h1
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-3xl font-bold mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text"
        >
          Call Center
        </motion.h1>
        <motion.p
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-muted-foreground"
        >
          Process leads one at a time with AI-powered note taking
        </motion.p>
      </div>

      {/* Filters Card */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <GlassCard className="p-6 space-y-6">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Filter className="h-4 w-4 text-primary" />
            Configure Filters
          </div>

          <div className="grid gap-5">
            <div>
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Lead Source
              </label>
              <Select value={sourceFilter} onValueChange={(v) => onSourceChange(v as SourceFilter)}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="aged_leads">Aged Leads Only</SelectItem>
                  <SelectItem value="applications">New Applicants Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                License Status
              </label>
              <Select value={licenseFilter} onValueChange={(v) => onLicenseChange(v as LicenseFilter)}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="licensed">Licensed</SelectItem>
                  <SelectItem value="unlicensed">Unlicensed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Lead Status
              </label>
              <Select value={statusFilter} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New / Uncontacted</SelectItem>
                  <SelectItem value="no_pickup">No Pickup (Retry)</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={onStart}
            size="lg"
            className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
          >
            <Phone className="h-5 w-5 mr-2" />
            Start Calling
          </Button>
        </GlassCard>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-xs text-muted-foreground text-center mt-6"
      >
        Keyboard: <span className="text-foreground/70">R</span> record
        • <span className="text-foreground/70">1-6</span> actions
        • <span className="text-foreground/70">N</span> skip
        • <span className="text-foreground/70">ESC</span> exit
      </motion.p>
    </div>
  );
}
