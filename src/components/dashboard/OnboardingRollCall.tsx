import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, Copy, PhoneOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";

/**
 * MP-339: the Monday roll call.
 *
 * Sam asked for "the full list of people who are new who should be joined
 * today". The list is only useful if it separates the blockers, because each
 * one is a different action: someone who is simply not in Discord needs a
 * nudge, someone with no contact details on file can only be reached by their
 * manager, and someone whose email is mistyped has been receiving nothing at
 * all while the system recorded sends as successful.
 *
 * Unreachable people are shown, never filtered out. They are the ones most
 * likely to be quietly lost, so hiding them is the failure this panel exists
 * to prevent.
 */
type RollCallRow = {
  agent_id: string;
  display_name: string;
  hired_on: string;
  days_since_hire: number;
  license_status: string;
  onboarding_stage: string;
  manager_name: string;
  email: string | null;
  phone: string | null;
  has_login: boolean;
  in_discord: boolean;
  email_deliverable: boolean;
  reachable: boolean;
  blocker: string;
};

function toneFor(row: RollCallRow) {
  if (!row.reachable) return "border-rose-500/40 bg-rose-500/5";
  if (!row.email_deliverable || !row.has_login) return "border-amber-500/40 bg-amber-500/5";
  return "border-border";
}

export function OnboardingRollCall() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["onboarding-roll-call"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_onboarding_roll_call" as never, { p_days: 14 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as RollCallRow[];
    },
  });

  if (isLoading) return <Skeleton className="h-40 rounded-lg" />;
  // A viewer with no new hires gets nothing rather than an empty box.
  if (isError || !data || data.length === 0) return null;

  const notIn = data.filter((r) => !r.in_discord);
  const unreachable = data.filter((r) => !r.reachable);
  const undeliverable = data.filter((r) => r.reachable && !r.email_deliverable);
  const noLogin = data.filter((r) => r.reachable && r.email_deliverable && !r.has_login);

  const copyList = async () => {
    const text = data
      .filter((r) => r.reachable)
      .map((r) => `${r.display_name}\t${r.email ?? "-"}\t${r.phone ?? "-"}\t${r.manager_name}\t${r.blocker}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${data.filter((r) => r.reachable).length} contactable people`);
    } catch {
      toast.error("Clipboard is blocked in this browser");
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <CalendarCheck className="h-3 w-3" />Joining today · new hires
          </p>
          <Badge variant="outline" className="border-primary/40 text-primary">{notIn.length} not in Discord</Badge>
          {unreachable.length > 0 && (
            <Badge variant="outline" className="border-rose-500/40 text-rose-500">{unreachable.length} unreachable</Badge>
          )}
          {undeliverable.length > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">{undeliverable.length} bad email</Badge>
          )}
          {noLogin.length > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">{noLogin.length} no login</Badge>
          )}
          <Button size="sm" variant="outline" className="ml-auto h-7 gap-1.5 text-xs" onClick={() => void copyList()}>
            <Copy className="h-3 w-3" />Copy contacts
          </Button>
        </div>

        <div className="space-y-1.5">
          {data.map((row) => (
            <div
              key={row.agent_id}
              className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2", toneFor(row))}
            >
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{row.display_name}</span>
              {!row.reachable && <PhoneOff className="h-3.5 w-3.5 shrink-0 text-rose-500" />}
              {row.reachable && !row.email_deliverable && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <span className="text-[11px] text-muted-foreground">{row.blocker}</span>
              <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                {row.manager_name} · {formatTimeAgo(row.hired_on)}
              </span>
            </div>
          ))}
        </div>

        {unreachable.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            No email or phone is on file for {unreachable.length} of these hires, so no send can reach them — their
            manager has to. Fix the contact details on{" "}
            <Link className="text-primary underline-offset-2 hover:underline" to="/dashboard/team">the team page</Link>{" "}
            and they rejoin the normal onboarding flow.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
