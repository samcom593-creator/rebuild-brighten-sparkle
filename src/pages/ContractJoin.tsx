import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailTypoHint } from "@/components/ui/email-typo-hint";
import { maskUsPhoneInput } from "@/lib/phone";
import { contractingDownlines, type Verdict } from "@/lib/contractingDownlines";

/**
 * /contract/:slug — the ONE link a manager sends (MP-304).
 *
 * Step 1 (here): the recruit's legal name, email, mobile and NPN, captured once and validated by the database
 * (NPN shape, near-duplicate NPNs, email typos, who the upline is). The record is committed and the Ethos leg
 * queued BEFORE anything else happens. Step 2: the browser is sent to the manager's MGN Agent Hub link to finish
 * carrier contracting. The redirect host is allow-listed server-side and checked again here; this page never
 * sends anyone anywhere but mgnagenthub.com.
 */

type Resolved = { ok: boolean; manager_name?: string; sub_agency?: string; redirect_host?: string; error?: string };
type Field = "first_name" | "last_name" | "email" | "phone" | "npn";
const LABEL: Record<Field, string> = { first_name: "Legal first name (as on your licence)", last_name: "Legal last name (as on your licence)", email: "Email", phone: "Mobile", npn: "NPN" };
const REDIRECT_HOST = /^(www\.)?mgnagenthub\.com$/;

export default function ContractJoin() {
  usePageTitle("Get contracted · Galaxy");
  const { slug = "" } = useParams<{ slug: string }>();
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(true);
  const [values, setValues] = useState<Record<Field, string>>({ first_name: "", last_name: "", email: "", phone: "", npn: "" });
  const [licensed, setLicensed] = useState(true);
  const [problem, setProblem] = useState<{ field: Field | "form"; text: string; suggestion?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ redirect_url?: string; parked?: boolean; manager_name?: string; comp_pct?: number | null; provisioned?: boolean } | null>(null);
  const [countdown, setCountdown] = useState(4);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await contractingDownlines.resolve(slug);
      if (cancelled) return;
      setResolved(r.data ?? { ok: false, error: r.error ?? "lookup_failed" });
      setResolving(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const redirectAllowed = useMemo(() => {
    if (!done?.redirect_url) return false;
    try { return REDIRECT_HOST.test(new URL(done.redirect_url).host); } catch { // empty-catch-allow:url-parse-guard
      return false;
    }
  }, [done?.redirect_url]);

  useEffect(() => {
    if (!redirectAllowed || !done?.redirect_url) return;
    if (countdown <= 0) { window.location.assign(done.redirect_url); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [redirectAllowed, countdown, done?.redirect_url]);

  const set = (k: Field, v: string) => { setValues((s) => ({ ...s, [k]: k === "phone" ? maskUsPhoneInput(v) : v })); if (problem?.field === k) setProblem(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const required: Field[] = licensed ? ["first_name", "last_name", "email", "phone", "npn"] : ["first_name", "last_name", "email", "phone"];
    const empty = required.find((k) => !values[k].trim());
    if (empty) { setProblem({ field: empty, text: `${LABEL[empty]} is needed.` }); return; }
    setSubmitting(true);
    try {
      const r = await contractingDownlines.join(slug, {
        first_name: values.first_name.trim(), last_name: values.last_name.trim(), email: values.email.trim().toLowerCase(),
        phone: values.phone, npn: values.npn.replace(/\D/g, ""), license_status: licensed ? "licensed" : "unlicensed",
        company_website: "",
      });
      const d = r.data as (Verdict & { redirect_url?: string; parked?: boolean; manager_name?: string }) | null;
      if (!d?.ok) {
        const field = (d?.field as Field | undefined) ?? "form";
        setProblem({ field: (["first_name", "last_name", "email", "phone", "npn"] as string[]).includes(field) ? (field as Field) : "form", text: String(d?.message ?? r.error ?? "Not saved. Try again."), suggestion: d?.suggestion ?? null });
        return;
      }
      setDone({ redirect_url: d.redirect_url, parked: d.parked, manager_name: d.manager_name, comp_pct: d.comp_pct ?? null, provisioned: d.provisioned });
    } finally { setSubmitting(false); }
  };

  const err = (k: Field) => (problem?.field === k ? (
    <p role="alert" className="text-xs text-destructive">
      {problem.text}
      {problem.suggestion ? <> Did you mean <button type="button" className="underline font-medium" onClick={() => { set("email", problem.suggestion as string); setProblem(null); }}>{problem.suggestion}</button>?</> : null}
    </p>
  ) : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="page-enter mx-auto w-full max-w-xl space-y-5 px-4 pb-24 pt-10 sm:px-6">
        {resolving ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your link…</div>
        ) : !resolved?.ok ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h1 className="text-xl font-semibold">This link isn't valid</h1>
            <p className="text-sm text-muted-foreground">Ask the person who sent it for a fresh one, or apply directly.</p>
            <Button asChild className="h-11"><Link to="/apply">Apply to Galaxy</Link></Button>
          </div>
        ) : done ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-5" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="h-5 w-5" aria-hidden /><span className="font-semibold">Saved with {done.manager_name ?? resolved.manager_name}'s team.</span></div>
            {done.parked ? (
              <>
                <p className="text-sm">You're in. Carrier contracting needs a life licence first, so step 2 is getting licensed. Come back through this same link once you have your NPN.</p>
                <Button asChild className="h-11"><Link to="/get-licensed">Start licensing</Link></Button>
              </>
            ) : redirectAllowed ? (
              <>
                <p className="text-sm">Step 2 of 2: finish your carrier contracting at <span className="font-medium">MGN Agent Hub</span>. Taking you there in {countdown}s.</p>
                {done.comp_pct != null ? <p className="text-xs text-muted-foreground">Submitted at {done.comp_pct}% · 6 Month Advance. Your manager can adjust the comp from Galaxy.</p> : null}
                <Button className="h-11" onClick={() => window.location.assign(done.redirect_url as string)}>Continue to MGN <ArrowRight className="ml-1 h-4 w-4" aria-hidden /></Button>
              </>
            ) : (
              <p className="text-sm">Saved. The MGN link for this team is not set up yet — your manager will send it.</p>
            )}
          </div>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Galaxy Financial · contracting</p>
              <h1 className="text-xl font-semibold">Get contracted under {resolved.manager_name}</h1>
              <p className="text-sm text-muted-foreground">Step 1 of 2. Enter your details exactly as they appear on your insurance licence. Step 2 takes you to MGN Agent Hub to finish.</p>
            </header>
            <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Contracting details">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="cj-first">{LABEL.first_name}</Label><Input id="cj-first" autoComplete="given-name" value={values.first_name} onChange={(e) => set("first_name", e.target.value)} aria-invalid={problem?.field === "first_name" || undefined} className="h-11" />{err("first_name")}</div>
                <div className="space-y-1"><Label htmlFor="cj-last">{LABEL.last_name}</Label><Input id="cj-last" autoComplete="family-name" value={values.last_name} onChange={(e) => set("last_name", e.target.value)} aria-invalid={problem?.field === "last_name" || undefined} className="h-11" />{err("last_name")}</div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cj-email">{LABEL.email}</Label>
                <Input id="cj-email" type="email" autoComplete="email" inputMode="email" value={values.email} onChange={(e) => set("email", e.target.value)} aria-invalid={problem?.field === "email" || undefined} className="h-11" />
                <EmailTypoHint value={values.email} onAccept={(next) => set("email", next)} />
                {err("email")}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="cj-phone">{LABEL.phone}</Label><Input id="cj-phone" type="tel" autoComplete="tel" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={problem?.field === "phone" || undefined} className="h-11" />{err("phone")}</div>
                <div className="space-y-1"><Label htmlFor="cj-npn">{LABEL.npn}</Label><Input id="cj-npn" inputMode="numeric" value={values.npn} onChange={(e) => set("npn", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} disabled={!licensed} aria-invalid={problem?.field === "npn" || undefined} className="h-11" />{err("npn")}</div>
              </div>
              {/* Honeypot: never shown, never focusable; anything in it came from automation. */}
              <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" defaultValue="" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} />
                <span>I hold a current life insurance licence and the NPN above is mine.</span>
              </label>
              {problem?.field === "form" ? <p role="alert" className="text-sm text-destructive">{problem.text}</p> : null}
              <Button type="submit" className="h-11 w-full" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Saving…</> : <>Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden /></>}</Button>
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> We never ask for your SSN, bank details or documents here. Carrier paperwork happens inside MGN Agent Hub.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
