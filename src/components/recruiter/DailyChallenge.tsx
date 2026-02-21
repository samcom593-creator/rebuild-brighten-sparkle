import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Target, CheckCircle2, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Lead {
  id: string;
  last_contacted_at: string | null;
  contacted_at: string | null;
  license_progress: string | null;
  created_at: string;
}

interface DailyChallengeProps {
  leads: Lead[];
  onXP: (pts: number, label: string) => void;
}

interface Challenge {
  id: string;
  title: string;
  target: number;
  current: number;
  xp: number;
}

function getStorageKey() {
  return `apex_daily_challenges_${format(new Date(), "yyyy-MM-dd")}`;
}

export function DailyChallenge({ leads, onXP }: DailyChallengeProps) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  // Load completed state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getStorageKey());
      if (saved) setCompletedIds(new Set(JSON.parse(saved)));
    } catch { /* ignore */ }
  }, []);

  const challenges = useMemo<Challenge[]>(() => {
    const now = Date.now();
    const overdue = leads.filter((l) => {
      const ts = l.last_contacted_at || l.contacted_at;
      if (!ts) return true;
      return (now - new Date(ts).getTime()) > 48 * 3600 * 1000;
    });

    const inCourse = leads.filter(
      (l) => l.license_progress === "course_purchased" || l.license_progress === "finished_course"
    );

    const result: Challenge[] = [];

    if (overdue.length >= 3) {
      result.push({
        id: "contact_overdue",
        title: `Contact ${Math.min(3, overdue.length)} overdue leads`,
        target: Math.min(3, overdue.length),
        current: Math.min(3, overdue.length) - overdue.length, // will be negative, clamp below
        xp: 25,
      });
    }

    if (inCourse.length >= 2) {
      result.push({
        id: "move_course",
        title: "Move 2 leads past Course stage",
        target: 2,
        current: 0,
        xp: 25,
      });
    }

    if (result.length === 0) {
      result.push({
        id: "contact_any",
        title: "Contact 5 leads today",
        target: 5,
        current: 0,
        xp: 25,
      });
    }

    return result;
  }, [leads]);

  const handleComplete = (challenge: Challenge) => {
    if (completedIds.has(challenge.id)) return;
    const next = new Set(completedIds);
    next.add(challenge.id);
    setCompletedIds(next);
    localStorage.setItem(getStorageKey(), JSON.stringify([...next]));
    onXP(challenge.xp, `🎯 Challenge: ${challenge.title}`);
  };

  const allDone = challenges.every((c) => completedIds.has(c.id));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1">
          <Target className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-medium">Daily Challenges</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1.5">
            {completedIds.size}/{challenges.length}
          </Badge>
          {allDone && (
            <Badge className="text-[9px] h-4 px-1.5 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              Complete!
            </Badge>
          )}
          <span className="ml-auto">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2 pb-1">
          {challenges.map((c) => {
            const done = completedIds.has(c.id);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all",
                  done
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    : "border-border bg-card text-foreground"
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <Target className="h-4 w-4 text-amber-400 shrink-0" />
                )}
                <span className={cn("flex-1", done && "line-through opacity-70")}>{c.title}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">
                  <Zap className="h-2 w-2 mr-0.5" /> {c.xp} XP
                </Badge>
                {!done && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => handleComplete(c)}
                  >
                    Done
                  </Button>
                )}
              </motion.div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
