import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * InlineEditApplicantField — single-field inline editor for any
 * applications.* text column.
 *
 * Sam directive 2026-06-17: "platform is missing the full connectivity
 * and ability to change applications." Tap any field on the applicants
 * grid → edit in place → blur (or Enter) saves via the Supabase update.
 *
 * Designed for compact use inside table cells.
 */

interface Props {
  applicationId: string;
  field: "first_name" | "last_name" | "email" | "phone" | "notes" | "city" | "state";
  value: string | null | undefined;
  placeholder?: string;
  className?: string;
  /** Optional callback after a successful save (e.g. to refetch the list). */
  onSaved?: () => void;
}

export function InlineEditApplicantField({
  applicationId,
  field,
  value,
  placeholder,
  className,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  async function save() {
    const trimmed = draft.trim();
    const original = (value ?? "").trim();
    if (trimmed === original) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        [field]: trimmed === "" ? null : trimmed,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("applications")
        .update(patch)
        .eq("id", applicationId);
      if (error) throw error;
      toast.success(`${field.replace(/_/g, " ")} updated`);
      setEditing(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["applications"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-applicants"] }),
      ]);
      onSaved?.();
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message?.slice(0, 100) ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cn(
          "group inline-flex items-center gap-1 max-w-full text-left",
          "hover:text-foreground transition-colors",
          className,
        )}
        title={`Tap to edit ${field.replace(/_/g, " ")}`}
      >
        <span className="truncate">{value || placeholder || "—"}</span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
      </button>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Input
        ref={inputRef}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          // Defer slightly so the Save / Cancel buttons can register clicks.
          window.setTimeout(() => {
            if (editing && !busy) save();
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="h-7 text-xs"
        placeholder={placeholder}
      />
      <button
        type="button"
        disabled={busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={save}
        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-emerald-500/15 text-emerald-500"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
      <button
        type="button"
        disabled={busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-rose-500/15 text-rose-500"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default InlineEditApplicantField;
