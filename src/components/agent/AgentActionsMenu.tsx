import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, ChevronDown, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * AgentActionsMenu — reusable action menu mounted anywhere an agent or
 * applicant is clicked (AgentDetail, CRM, pipeline, dashboard cards,
 * call center contact pop). PL-056.
 *
 * The first action is "Add to Seminar" which calls register_for_seminar
 * RPC. The RPC matches by email — so if the agent already has an
 * applications row (most do), the RPC updates that row and writes a
 * seminar_registrations entry. For a brand new contact, it creates both.
 *
 * Extensible: future actions ("Send onboarding email", "Mark stuck", etc)
 * drop in beside the seminar one.
 */

export type AgentActionsPerson = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  /** "licensed" | "studying" | "unlicensed" — defaults to "unlicensed" */
  licenseStatus?: string | null;
  /** Where the click is coming from (used for analytics passthrough) */
  source?: string;
};

interface AgentActionsMenuProps {
  person: AgentActionsPerson;
  /** Variant of the trigger button. Default is small outline. */
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  /** Optional className passthrough to the trigger button */
  className?: string;
}

/** Next four Apex seminar slots (Wed + Sat in America/Chicago). */
function useNextSeminarSlots() {
  return useQuery({
    queryKey: ["agent-actions-next-seminars"],
    queryFn: async () => {
      // We could fetch from a system_settings or seminar_slots table, but
      // Apex's slots are "every Wed + Sat" — deterministic. Compute locally
      // so the menu opens instantly without a round trip.
      const out: { date: string; label: string }[] = [];
      const cursor = new Date();
      for (let i = 0; i < 30 && out.length < 4; i++) {
        const day = new Date(cursor);
        day.setDate(cursor.getDate() + i);
        const dow = day.getDay(); // 0=Sun, 3=Wed, 6=Sat
        if (dow === 3 || dow === 6) {
          out.push({
            date: format(day, "yyyy-MM-dd"),
            label: format(day, "EEE · MMM d"),
          });
        }
      }
      return out;
    },
    staleTime: 30 * 60_000,
  });
}

export function AgentActionsMenu({
  person,
  variant = "outline",
  size = "sm",
  className,
}: AgentActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [submittingSlot, setSubmittingSlot] = useState<string | null>(null);
  const { data: slots = [] } = useNextSeminarSlots();

  // Guard: must have at least an email or the RPC has nothing to match on
  const hasIdentity = useMemo(
    () => Boolean(person.email && person.email.includes("@")),
    [person.email],
  );

  async function handleAddToSeminar(slotDate: string, slotLabel: string) {
    if (!hasIdentity) {
      toast.error("This person has no email on file — add one first.");
      return;
    }
    setSubmittingSlot(slotDate);
    try {
      // 2026-06-18 zero-Unknown sweep: pass em-dash, not "Unknown" placeholder.
      const { error } = await (supabase.rpc as any)("register_for_seminar", {
        p_first_name: person.firstName || "—",
        p_last_name: person.lastName || "—",
        p_email: person.email.trim().toLowerCase(),
        p_phone: person.phone ?? "",
        p_seminar_date: slotDate,
        p_license_status: (person.licenseStatus ?? "unlicensed").toLowerCase(),
        p_source: person.source ?? "agent-actions-menu",
      });
      if (error) throw error;
      toast.success(`Added ${person.firstName || "agent"} to ${slotLabel} seminar`);
      setOpen(false);
    } catch (err: any) {
      const msg = err?.message ?? "Couldn't add to seminar";
      toast.error(msg);
    } finally {
      setSubmittingSlot(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <CalendarPlus className="mr-2 h-4 w-4" />
          Add to Seminar
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Next Apex seminars
        </p>
        <div className="mt-1 flex flex-col gap-1">
          {slots.map((slot) => {
            const busy = submittingSlot === slot.date;
            return (
              <button
                key={slot.date}
                type="button"
                onClick={() => handleAddToSeminar(slot.date, slot.label)}
                disabled={busy || submittingSlot !== null}
                className="flex items-center justify-between rounded-md px-2 py-2 text-sm transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="font-medium">{slot.label}</span>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </button>
            );
          })}
          {slots.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No upcoming seminar dates found.</p>
          ) : null}
        </div>
        {!hasIdentity ? (
          <p className="mt-2 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
            Missing email — add one to enable.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export default AgentActionsMenu;
