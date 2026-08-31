import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, UserRoundCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ContractingSuccessModal,
  type ContractingAcceptance,
} from "@/components/contracting/ContractingSuccessModal";
import {
  validateIntake,
  SERVER_ERROR_COPY,
  type ContractingField,
} from "@/lib/contractingIntake";

/**
 * StartContracting — the public, shareable APEX contracting intake.
 *
 * Deliberately unauthenticated: Sam hands this link to producers who have no
 * APEX login, which is the entire point of a one-link workflow.
 *
 * It asks for five things and nothing else. No PA number, no SSN, no date of
 * birth, no banking details, no password, no medical questions, no uploads.
 * Anything beyond the five is data we would then be holding, for no gain.
 *
 * It never claims an email, Discord post, or spreadsheet row happened without
 * a durable receipt. The result page describes only the recruit's real state.
 */

const STORAGE_KEY = "apex.contracting.intake";
const FIELDS: Array<{ name: ContractingField; label: string; type: string; autoComplete: string; inputMode?: "text" | "tel" | "numeric" | "email" }> = [
  { name: "first_name", label: "First name", type: "text", autoComplete: "given-name" },
  { name: "last_name", label: "Last name", type: "text", autoComplete: "family-name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email", inputMode: "email" },
  { name: "phone", label: "Mobile number", type: "tel", autoComplete: "tel", inputMode: "tel" },
  { name: "npn", label: "NPN", type: "text", autoComplete: "off", inputMode: "numeric" },
];

type PrefillRow = Partial<Record<ContractingField, string | null>>;
const SUPPORTS_AUTH_PREFILL = typeof (supabase as typeof supabase & {
  auth?: { getSession?: unknown };
}).auth?.getSession === "function";

function splitFullName(fullName: string | null | undefined): Pick<PrefillRow, "first_name" | "last_name"> {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return {};
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function readStoredAcceptance(): ContractingAcceptance | null {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ContractingAcceptance : null;
  } catch {
    window.localStorage?.removeItem(STORAGE_KEY);
    return null;
  }
}

export default function StartContracting() {
  usePageTitle("Start Contracting · APEX Financial");

  const [form, setForm] = useState<Record<ContractingField, string>>({
    first_name: "", last_name: "", email: "", phone: "", npn: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ContractingField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<ContractingAcceptance | null>(readStoredAcceptance);
  const [prefilledFields, setPrefilledFields] = useState<Set<ContractingField>>(new Set());
  const [prefillLoading, setPrefillLoading] = useState(SUPPORTS_AUTH_PREFILL && !accepted);
  const [showAllFields, setShowAllFields] = useState(false);

  // Signed-in producers already supplied most of this during application and
  // account setup. Merge those records here and leave only genuinely missing
  // fields visible. The public/shareable version still shows the original five
  // fields when no authenticated profile exists.
  useEffect(() => {
    if (accepted) return;
    let cancelled = false;

    const loadSavedDetails = async () => {
      const auth = (supabase as typeof supabase & {
        auth?: { getSession?: () => Promise<{ data: { session: { user: { id: string; email?: string } } | null } }> };
      }).auth;

      if (!auth?.getSession) {
        setPrefillLoading(false);
        return;
      }

      try {
        const { data: sessionData } = await auth.getSession();
        const currentUser = sessionData.session?.user;
        if (!currentUser || cancelled) return;

        const [profileResult, agentResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name, email, phone")
            .eq("user_id", currentUser.id)
            .maybeSingle(),
          supabase
            .from("agents")
            .select("display_name, nipr_number, source_application_id")
            .eq("user_id", currentUser.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        const profile = profileResult.data;
        const agent = agentResult.data;
        let application: {
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          nipr_number: string | null;
        } | null = null;

        if (agent?.source_application_id) {
          const applicationResult = await supabase
            .from("applications")
            .select("first_name, last_name, email, phone, nipr_number")
            .eq("id", agent.source_application_id)
            .maybeSingle();
          application = applicationResult.data;
        }

        if (cancelled) return;
        const splitName = splitFullName(profile?.full_name ?? agent?.display_name);
        const saved: PrefillRow = {
          first_name: application?.first_name ?? splitName.first_name,
          last_name: application?.last_name ?? splitName.last_name,
          email: profile?.email ?? currentUser.email ?? application?.email ?? null,
          phone: profile?.phone ?? application?.phone ?? null,
          npn: agent?.nipr_number ?? application?.nipr_number ?? null,
        };
        const found = new Set<ContractingField>();

        setForm((previous) => {
          const next = { ...previous };
          for (const field of FIELDS) {
            const value = saved[field.name]?.trim();
            if (value) {
              found.add(field.name);
              if (!next[field.name].trim()) next[field.name] = value;
            }
          }
          return next;
        });
        setPrefilledFields(found);
      } catch { // empty-catch-allow:best-effort-prefill
        // Prefill is a convenience. The original five-field intake remains
        // fully usable when a saved record cannot be read.
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    };

    void loadSavedDetails();
    return () => {
      cancelled = true;
    };
  }, [accepted]);

  const setField = (name: ContractingField, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const validated = validateIntake(form);
    if (!validated.ok) {
      const next: Partial<Record<ContractingField, string>> = {};
      for (const e of validated.errors) next[e.field] = e.message;
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-contracting-intake", {
        body: { ...form, company_website: honeypot },
      });

      if (error) {
        // submit-contracting-intake answers a validation failure with HTTP 400 and
        // a body naming the offending field. supabase-js turns EVERY non-2xx into
        // this `error` with `data` set to null, so that body never reached the
        // SERVER_ERROR_COPY mapping below — those five field messages were
        // unreachable code, and a producer whose details the server rejected was
        // told to check their connection. Read the response the server actually
        // sent before falling back to a generic message.
        let serverCode: string | undefined;
        let serverField: ContractingField | undefined;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const parsed = (await ctx.json()) as { error?: { message?: string; field?: string } | string };
            const detail = typeof parsed?.error === "string" ? { message: parsed.error } : parsed?.error;
            serverCode = detail?.message;
            serverField = detail?.field as ContractingField | undefined;
          }
        } catch {
          // Body was absent or not JSON — a genuine transport failure. Leave both
          // unset so the generic message below is what the producer sees.
          serverCode = undefined;
        }

        const mapped = serverCode ? SERVER_ERROR_COPY[serverCode] : undefined;
        if (mapped) {
          setErrors({ [mapped.field]: mapped.message });
          return;
        }
        if (serverField) {
          setErrors({ [serverField]: "Check this field and try again." });
          return;
        }
        setFormError("We could not record that. Check your connection and try again.");
        return;
      }

      // The honeypot path answers without an intake id. Treat a missing id as a
      // non-event rather than showing a success screen for a row that does not
      // exist.
      const result = data as Partial<ContractingAcceptance> & { ok?: boolean; error?: string; field?: string };
      if (!result?.ok || !result.intake_id) {
        const mapped = result?.error ? SERVER_ERROR_COPY[result.error] : undefined;
        if (mapped) setErrors({ [mapped.field]: mapped.message });
        else setFormError("We could not record that. Check your details and try again.");
        return;
      }

      const next: ContractingAcceptance = {
        intake_id: result.intake_id,
        status: result.status ?? "accepted",
        review_reason: result.review_reason ?? null,
        onboarding_email_sent: result.onboarding_email_sent === true,
      };
      setAccepted(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Persistence is a convenience; the intake is already durable server-side.
        setFormError(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const missingFields = FIELDS.filter((field) => !form[field.name].trim());
  const readySavedFields = FIELDS.filter(
    (field) => prefilledFields.has(field.name) && form[field.name].trim(),
  );
  const visibleFields = showAllFields || prefilledFields.size === 0
    ? FIELDS
    : missingFields;

  return (
    // Recruits land here from the black+gold funnel; the audit flagged the
    // previous inherited washed-white ground as "looks like a broken unstyled
    // page". Commit to the brand shell explicitly — this page renders dark
    // regardless of the viewer's theme, matching /apply.
    <div className="dark min-h-screen bg-[#0A0A0A] text-foreground">
      <header className="border-b border-white/10 px-6 py-4">
        <p className="text-sm font-bold tracking-[0.2em] text-[#C9A961]">APEX FINANCIAL</p>
      </header>
      <div className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6 sm:py-16">
      {accepted ? (
        <ContractingSuccessModal accepted={accepted} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Start contracting with APEX</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We'll use the information already on your profile and ask only for anything that's missing. Then you'll prepare EFT and E&amp;O in the secure carrier portals.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            {prefillLoading && (
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
                Checking for saved details…
              </div>
            )}

            {!prefillLoading && readySavedFields.length > 0 && (
              <section className="rounded-md border border-primary/30 bg-primary/5 p-4" aria-labelledby="saved-contracting-details">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <UserRoundCheck className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <h2 id="saved-contracting-details" className="text-sm font-semibold text-white">
                        {missingFields.length === 0
                          ? "Your details are ready"
                          : `${readySavedFields.length} detail${readySavedFields.length === 1 ? "" : "s"} already filled`}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Pulled securely from your profile and original application.
                      </p>
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={() => setShowAllFields((shown) => !shown)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {showAllFields ? "Done" : "Edit"}
                  </Button>
                </div>

                {!showAllFields && (
                  <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                    {readySavedFields.map((field) => (
                      <div key={field.name} className="min-w-0 rounded border border-white/10 bg-black/20 px-3 py-2">
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd className="mt-0.5 truncate font-medium text-foreground">{form[field.name]}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}

            {!prefillLoading && missingFields.length > 0 && readySavedFields.length > 0 && !showAllFields && (
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                {missingFields.length === 1 ? "One detail left" : `${missingFields.length} details left`}
              </div>
            )}

            {!prefillLoading && visibleFields.map((field) => (
              <div key={field.name}>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  {showAllFields && prefilledFields.has(field.name) && (
                    <span className="text-[11px] font-medium text-primary">Saved</span>
                  )}
                </div>
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  inputMode={field.inputMode}
                  autoComplete={field.autoComplete}
                  value={form[field.name]}
                  onChange={(e) => setField(field.name, e.target.value)}
                  aria-invalid={errors[field.name] ? true : undefined}
                  aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
                  className="mt-1.5"
                />
                {errors[field.name] && (
                  <p id={`${field.name}-error`} role="alert" className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
                    {errors[field.name]}
                  </p>
                )}
              </div>
            ))}

            {/* Honeypot. Hidden from people and from assistive technology, so
                anything in it came from something automating the page. */}
            <div aria-hidden className="hidden">
              <label htmlFor="company_website">Company website</label>
              <input
                id="company_website"
                name="company_website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            {formError && (
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{formError}</p>
            )}

            <Button type="submit" disabled={submitting || prefillLoading} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Submitting
                </>
              ) : (
                missingFields.length === 0 ? "Start contracting" : "Complete and start contracting"
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Every required launch step stays visible in your roadmap. Sensitive identity and banking details are completed only inside protected carrier portals.
            </p>
          </form>
        </>
      )}
      </div>
    </div>
  );
}
