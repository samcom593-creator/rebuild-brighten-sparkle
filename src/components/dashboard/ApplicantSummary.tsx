import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, RefreshCw, User, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Applicant {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  instagram_handle: string;
  has_license: boolean;
  years_experience: string;
  current_occupation: string;
  why_join: string;
  status: string;
  created_at: string;
}

interface ApplicantSummaryProps {
  applicant: Applicant;
  className?: string;
}

export function ApplicantSummary({ applicant, className }: ApplicantSummaryProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const getSummary = async () => {
    if (summary && !isExpanded) {
      setIsExpanded(true);
      return;
    }
    
    setIsLoading(true);
    setIsExpanded(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          type: 'summary',
          applicant: {
            fullName: applicant.full_name,
            email: applicant.email,
            phone: applicant.phone,
            city: applicant.city,
            state: applicant.state,
            instagramHandle: applicant.instagram_handle,
            hasLicense: applicant.has_license,
            yearsExperience: applicant.years_experience,
            currentOccupation: applicant.current_occupation,
            whyJoin: applicant.why_join,
            status: applicant.status,
            createdAt: applicant.created_at,
          },
        },
      });

      if (error) throw error;
      setSummary(data.content);
    } catch (error) {
      console.error('Summary error:', error);
      toast({
        title: "Error",
        description: "Failed to generate summary. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refresh = async () => {
    setSummary(null);
    await getSummary();
  };

  return (
    <div className={cn("", className)}>
      <Button
        onClick={getSummary}
        disabled={isLoading}
        variant="ghost"
        size="sm"
        className="gap-2 text-primary hover:text-primary"
      >
        {isLoading ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        AI Summary
        {summary && (
          isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
        )}
      </Button>

      <AnimatePresence>
        {isExpanded && summary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-sm text-foreground leading-relaxed">{summary}</p>
                </div>
                <Button
                  onClick={refresh}
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-6 w-6 p-0"
                  disabled={isLoading}
                >
                  <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
