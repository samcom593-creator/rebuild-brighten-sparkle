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
  usePageTitle("Join the team · Galaxy");
  const { slug = "" } = useParams<{ slug: string }>();
  return <ContractJoinForm key={slug} slug={slug} />;
}

function ContractJoinForm({ slug }: { slug: string }) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [values, setValues] = useState<Record<Field, string>>({ first_name: "", last_name: "", email: "", phone: "", npn: "" });
  const [licensed, setLicensed] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<{ field: Field | "form"; text: string; suggestion?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ redirect_url?: string; parked?: boolean; manager_name?: string; comp_pct?: number | null; provisioned?: boolean; delivery?: string; intake_id?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolving(true); setLookupError(null);
    void (async () => {
      try {
        const r = await contractingDownlines.resolve(slug);
        if (cancelled) return;
        if (!r.data?.ok && r.status !== 404) {
          setResolved(null);
          setLookupError(r.error ?? "We could not check this link right now.");
        } else setResolved(r.data ?? { ok: false, error: r.error ?? "lookup_failed" });
      } catch (e) {
        if (!cancelled) setLookupError(e instanceof Error ? e.message : "We could not check this link right now.");
      } finally { if (!cancelled) setResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [slug, lookupAttempt]);

  const redirectAllowed = useMemo(() => {
    if (!done?.redirect_url) return false;
    try { const target = new URL(done.redirect_url); return target.protocol === "https:" && !target.username && !target.password && REDIRECT_HOST.test(target.host); } catch { // empty-catch-allow:url-parse-guard
      return false;
    }
  }, [done?.redirect_url]);

  // MP-ONE-LINK-MGN (2026-11-26). Sam: "make sure it redirects them to the MGN." A licensed person who just
  // saved is taken to MGN Agent Hub on a short countdown; the button stays for anyone who wants to go now,
  // and the receipt is on screen long enough to read. Only the allow-listed MGN host is ever assigned.
  // The countdown runs only when nothing needs the person's attention: a held delivery or an account that
  // did not provision keeps the receipt on screen until they choose to continue.
  const REDIRECT_SECONDS = 6;
  const blocked = !!done && (done.provisioned === false || done.delivery === "manual_review" || done.delivery === "failed" || done.delivery === "not_configured");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!done || done.parked || !redirectAllowed || blocked) { setSecondsLeft(null); return; }
    setSecondsLeft(REDIRECT_SECONDS);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = REDIRECT_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(tick);
        window.location.assign(done.redirect_url as string);
        return;
      }
      setSecondsLeft(left);
    }, 250);
    return () => window.clearInterval(tick);
  }, [done, redirectAllowed, blocked]);

  const set = (k: Field, v: string) => { setValues((s) => ({ ...s, [k]: k === "phone" ? maskUsPhoneInput(v) : v })); if (problem?.field === k) setProblem(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (licensed === null) { setProblem({ field: "form", text: "Choose your current license status before continuing." }); return; }
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
      setDone({ redirect_url: d.redirect_url, parked: d.parked, manager_name: d.manager_name, comp_pct: d.comp_pct ?? null, provisioned: d.parked && !d.agent_id ? false : d.provisioned, delivery: d.delivery, intake_id: d.intake_id });
    } catch (e) {
      setProblem({ field: "form", text: e instanceof Error ? e.message : "The request could not be confirmed. Check with your manager before trying again." });
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
        ) : lookupError ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h1 className="text-xl font-semibold">This link could not be checked</h1>
            <p role="alert" className="text-sm text-muted-foreground">{lookupError}</p>
            <Button type="button" variant="outline" className="h-11" onClick={() => setLookupAttempt((attempt) => attempt + 1)}>Retry link check</Button>
          </div>
        ) : !resolved?.ok ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h1 className="text-xl font-semibold">This link isn't valid</h1>
            <p className="text-sm text-muted-foreground">Ask the person who sent it for a fresh one, or apply directly.</p>
            <Button asChild className="h-11"><Link to="/apply">Apply to Galaxy</Link></Button>
          </div>
        ) : done ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-5" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="h-5 w-5" aria-hidden /><span className="font-semibold">Saved with {done.manager_name ?? resolved.manager_name}'s team.</span></div>
            {done.intake_id ? <p className="break-all text-xs text-muted-foreground">Request receipt: {done.intake_id}</p> : null}
            {done.provisioned === false ? <p role="alert" className="rounded-md border border-amber-500/40 p-3 text-sm">Your details are saved, but account setup needs attention. Give this receipt to your manager so they can resolve the existing request.</p> : done.provisioned === true ? <p className="text-sm">Your Galaxy account is linked to this request. <Link to="/login" className="underline">Open Galaxy sign-in</Link>.</p> : null}
            {done.parked ? (
              <>
                <p className="text-sm">Your next step is licensing. No Ethos submission has been made on this unlicensed path. Come back through this same link once you hold a current life license and have your NPN.</p>
                <Button asChild className="h-11"><Link to="/get-licensed">Start licensing</Link></Button>
              </>
            ) : redirectAllowed ? (
              <>
                <p className="text-sm">Continue to <span className="font-medium">MGN Agent Hub</span> to complete the carrier&apos;s steps. Your manager tracks the submission receipt and carrier confirmation separately.</p>
                {done.delivery === "manual_review" || done.delivery === "failed" || done.delivery === "not_configured" ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">The Ethos submission is held for review. Your manager must resolve the delivery blocker.</p> : <p className="text-sm text-muted-foreground">{done.delivery === "queued" ? "The Ethos request is queued; sheet delivery is not yet confirmed." : "Check the submission receipt with your manager."} Saving this form does not mean the carrier has approved your appointment.</p>}
                {done.comp_pct != null ? <p className="text-xs text-muted-foreground">Requested at {done.comp_pct}% · 6 Month Advance. Your manager can review this level in Galaxy.</p> : null}
                {secondsLeft !== null ? <p className="text-sm font-medium" aria-live="polite">Taking you there in {secondsLeft}…</p> : null}
                <Button className="h-11" onClick={() => window.location.assign(done.redirect_url as string)}>Continue to MGN <ArrowRight className="ml-1 h-4 w-4" aria-hidden /></Button>
              </>
            ) : (
              <p className="text-sm">Saved. The MGN link for this team is not set up yet — your manager will send it.</p>
            )}
          </div>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Galaxy Financial</p>
              <h1 className="text-xl font-semibold">Join {resolved.manager_name}&apos;s team</h1>
              <p className="text-sm text-muted-foreground">Enter your legal details and choose your current license status. Licensed agents receive an Ethos request receipt and continue to MGN Agent Hub. Unlicensed people start with licensing.</p>
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
                <div className="space-y-1"><Label htmlFor="cj-npn">{LABEL.npn}</Label><Input id="cj-npn" inputMode="numeric" value={values.npn} onChange={(e) => set("npn", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} disabled={licensed !== true} aria-invalid={problem?.field === "npn" || undefined} className="h-11" />{err("npn")}</div>
              </div>
              {/* Honeypot: never shown, never focusable; anything in it came from automation. */}
              <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" defaultValue="" />
              <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Current license status</legend>
                <label className="flex items-start gap-2 text-sm"><input type="radio" name="license-status" className="mt-1 h-4 w-4" checked={licensed === true} onChange={() => { setLicensed(true); setProblem(null); }} /><span>I hold a current life insurance license and the NPN above is mine.</span></label>
                <label className="flex items-start gap-2 text-sm"><input type="radio" name="license-status" className="mt-1 h-4 w-4" checked={licensed === false} onChange={() => { setLicensed(false); setProblem(null); }} /><span>I am not licensed yet.</span></label>
              </fieldset>
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
