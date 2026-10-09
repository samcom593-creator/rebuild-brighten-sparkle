import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { INTAKE_LABEL, US_STATES, npnProblem, saveMyProfile, type IntakeField, type IntakeValues } from "@/lib/contractReview";

/**
 * Complete your contracting profile.
 *
 * The page the contracting email and link point to. It is behind the normal sign-in, so the person is identified by
 * their login (never by anything typed here), the form is prefilled from what the website already knows, and the save
 * can only ever write to their own profile. Nobody on staff types a name or an email for it.
 *
 * Five fields and nothing else: NPN, first name, last name, email, resident state. Saving them does NOT mean carrier
 * contracting is complete, and this page says so. It does not submit anything to any carrier.
 */

interface Mine { ok: boolean; error?: string; npn?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; resident_state?: string | null; saved?: boolean }

const EMPTY: IntakeValues = { npn: "", first_name: "", last_name: "", email: "", resident_state: "" };

export default function ContractingProfile() {
  usePageTitle("Complete your contracting profile · Galaxy");
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ["my-contracting-profile"],
    staleTime: 0,
    retry: 1,
    queryFn: async (): Promise<Mine> => {
      const { data, error } = await supabase.rpc("get_my_contracting_profile");
      if (error) throw new Error(error.message);
      return (data ?? { ok: false, error: "Your profile did not load." }) as unknown as Mine;
    },
  });

  const [values, setValues] = useState<IntakeValues>(EMPTY);
  const [problem, setProblem] = useState<{ field: IntakeField | "all" | null; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Fill the form once per load of the person's record, never on a re-render that would erase what they typed.
  const loadedAt = mine.dataUpdatedAt;
  useEffect(() => {
    const d = mine.data;
    if (d?.ok) setValues({ npn: d.npn ?? "", first_name: d.first_name ?? "", last_name: d.last_name ?? "", email: d.email ?? "", resident_state: d.resident_state ?? "" });
  }, [loadedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: IntakeField, v: string) => { setValues((s) => ({ ...s, [k]: v })); if (problem?.field === k) setProblem(null); setDone(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const empty = (Object.keys(values) as IntakeField[]).find((k) => !values[k].trim());
    if (empty) { setProblem({ field: empty, text: `${INTAKE_LABEL[empty]} is needed.` }); return; }
    const npnIssue = npnProblem(values.npn);
    if (npnIssue) { setProblem({ field: "npn", text: npnIssue }); return; }
    setSaving(true);
    try {
      const r = await saveMyProfile(values);
      if (r.ok) { setProblem(null); setDone(true); void qc.invalidateQueries({ queryKey: ["my-contracting-profile"] }); }
      else setProblem({ field: (r.field as IntakeField | "all" | null) ?? null, text: r.error ?? "Not saved. Try again." });
    } finally { setSaving(false); }
  };

  const err = (k: IntakeField) => (problem?.field === k ? <p role="alert" className="text-xs text-destructive">{problem.text}</p> : null);

  return (
    <div className="page-enter mx-auto w-full max-w-xl space-y-4 px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Complete your contracting profile</h1>
        <p className="text-sm text-muted-foreground">
          Add your NPN number, first name, last name, email address and resident state. Our team uses this to coordinate the carrier portal steps and track Combine, AFLAC, GTO and Ethos on your profile.
        </p>
      </header>

      {mine.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your profile…</div>
      ) : mine.isError ? (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-semibold text-foreground">Your profile did not load.</p>
          <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => void mine.refetch()}>Try again</Button>
        </div>
      ) : !mine.data?.ok ? (
        <GlassCard className="p-4"><p className="text-sm text-foreground" role="status">{mine.data?.error ?? "We could not find your profile."}</p><p className="mt-1 text-xs text-muted-foreground">Ask the person who invited you to check your account.</p></GlassCard>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Contracting profile">
          {mine.data.saved ? <p className="text-xs text-muted-foreground">You already saved this once. You can correct it any time.</p> : <p className="text-xs text-muted-foreground">Some fields are filled in from your account. Check each one.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cp-first">{INTAKE_LABEL.first_name}</Label>
              <Input id="cp-first" autoComplete="given-name" value={values.first_name} onChange={(e) => set("first_name", e.target.value)} aria-invalid={problem?.field === "first_name" || undefined} className="h-11" />
              {err("first_name")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="cp-last">{INTAKE_LABEL.last_name}</Label>
              <Input id="cp-last" autoComplete="family-name" value={values.last_name} onChange={(e) => set("last_name", e.target.value)} aria-invalid={problem?.field === "last_name" || undefined} className="h-11" />
              {err("last_name")}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-email">{INTAKE_LABEL.email}</Label>
            <Input id="cp-email" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} aria-invalid={problem?.field === "email" || undefined} className="h-11" />
            {err("email")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cp-npn">{INTAKE_LABEL.npn}</Label>
              <Input id="cp-npn" inputMode="numeric" autoComplete="off" value={values.npn} onChange={(e) => set("npn", e.target.value)} aria-describedby="cp-npn-help" aria-invalid={problem?.field === "npn" || undefined} className="h-11" />
              <p id="cp-npn-help" className="text-xs text-muted-foreground">Your National Producer Number, digits only. Leading zeros stay.</p>
              {err("npn")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="cp-state">{INTAKE_LABEL.resident_state}</Label>
              <select id="cp-state" value={values.resident_state} onChange={(e) => set("resident_state", e.target.value)} aria-invalid={problem?.field === "resident_state" || undefined}
                className={cn("h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]")}>
                <option value="">Choose a state</option>
                {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
              {err("resident_state")}
            </div>
          </div>
          {problem && (problem.field === "all" || problem.field === null) ? <p role="alert" className="text-sm text-destructive">{problem.text}</p> : null}
          <Button type="submit" className="h-11 w-full sm:w-auto" disabled={saving}>{saving ? "Saving…" : "Save my profile"}</Button>
          {done ? (
            <p role="status" className="flex items-start gap-2 text-sm text-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> Saved. Submitting your information does not mean carrier contracting is complete. Our team will take the next steps in the carrier portals.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Submitting your information does not mean carrier contracting is complete.</p>
          )}
        </form>
      )}
    </div>
  );
}
