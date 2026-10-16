// FixNumber — correct an SSN, routing or account number the recording got wrong, right where the
// number is shown. Sam, 2026-10-16: "a lot of these SSN have extra numbers". The caller confirms the
// number with the client on the call and types it here. It is checked with the same rules the page
// flags with (checkNumber), checked again by booking_packet_fix_number, saved encrypted, and marked
// fixed so the extractor's next re-run cannot write the mis-heard number back over it.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { checkNumber, NUMBER_LABEL, numberNoun, type NumberField } from "@/lib/soldCallPacket";

const PLACEHOLDER: Record<NumberField, string> = {
  ssn: "9 digits",
  bank_routing: "9 digits",
  bank_account: "4 to 17 digits",
};

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

export function FixNumber({ packetId, field, hasValue, flagged, className }: {
  packetId: string;
  field: NumberField;
  /** A number is already on file (it reads "Edit" rather than "Add"). */
  hasValue: boolean;
  /** The number on file cannot be right (it reads "Fix" and stands out). */
  flagged: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const label = NUMBER_LABEL[field];
  const check = checkNumber(field, value);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={flagged ? "outline" : "ghost"}
        className={cn("h-7 px-2 font-sans text-xs", flagged && "border-red-500/50 text-red-700 dark:text-red-300", className)}
        onClick={() => setOpen(true)}
        aria-label={`${flagged ? "Fix" : hasValue ? "Edit" : "Add"} the ${numberNoun(field)}`}
      >
        {flagged ? "Fix" : hasValue ? "Edit" : "Add"}
      </Button>
    );
  }

  const close = () => { setOpen(false); setValue(""); };
  const save = async () => {
    if (saving || !check?.ok) return;
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as unknown as Rpc)("booking_packet_fix_number", {
        p_packet_id: packetId, p_field: field, p_value: check.digits,
      });
      if (error) throw new Error(error.message);
      toast.success(`${label} saved.`);
      close();
      void qc.invalidateQueries({ queryKey: ["sold-calls-sensitive"] });
      void qc.invalidateQueries({ queryKey: ["sold-call-sensitive"] });
      void qc.invalidateQueries({ queryKey: ["sold-calls-queue"] });
      void qc.invalidateQueries({ queryKey: ["sold-call-packet"] });
    } catch (e) {
      toast.error(`${label} not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={cn("mt-1 flex w-full flex-wrap items-center justify-end gap-2 font-sans", className)}
      onSubmit={(e) => { e.preventDefault(); void save(); }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={PLACEHOLDER[field]}
        aria-label={`${label} the client confirmed`}
        className="h-9 w-40 font-mono text-base sm:text-sm"
      />
      <Button type="submit" size="sm" className="h-9" disabled={saving || !check?.ok}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-9" onClick={close} disabled={saving}>Cancel</Button>
      {check && !check.ok && (
        <p className="w-full text-xs text-red-700 dark:text-red-300" role="status">{check.problem}</p>
      )}
    </form>
  );
}
