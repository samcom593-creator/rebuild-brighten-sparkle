import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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

export default function StartContracting() {
  usePageTitle("Start Contracting · APEX Financial");

  const [form, setForm] = useState<Record<ContractingField, string>>({
    first_name: "", last_name: "", email: "", phone: "", npn: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ContractingField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<ContractingAcceptance | null>(null);

  // Reload persistence. A producer who refreshes
  // must not be shown an empty form as though nothing happened — they would
  // submit again and wonder which one counted.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setAccepted(JSON.parse(raw) as ContractingAcceptance);
    } catch {
      // A corrupt or unavailable store just means we show the form again, which
      // is safe: resubmitting the same NPN returns the same intake.
      window.localStorage?.removeItem(STORAGE_KEY);
    }
  }, []);

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
            Five details route your request to the contracting spreadsheet and private support channel. Then you'll prepare EFT and E&O for carrier setup.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            {FIELDS.map((field) => (
              <div key={field.name}>
                <Label htmlFor={field.name}>{field.label}</Label>
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

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Submitting
                </>
              ) : (
                "Submit"
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              We ask for these five details only. We never ask for your SSN, date of
              birth, or bank details on this form.
            </p>
          </form>
        </>
      )}
      </div>
    </div>
  );
}
