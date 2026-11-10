// LicensingProofStep — the ONE unlicensed path (WP2, onboarding audit 2026-11-10).
//
// Rendered on /apply/success, /status/:id (ApplicationConfirmationV2) and the logged-in
// ApplicantHome, so every surface shows the same four steps in the same order:
//   1. Watch the 5-min video (new tab, so the applicant stays on this page)
//   2. Get the course
//   3. Upload your receipt (image or PDF) -> submit-licensing-proof
//   4. Book your licensing call (unlocks after the upload)
// plus a "Not ready to buy? Ask us first" human path that is ALWAYS visible, including
// when the upload errors. Before this, the confirmation page stacked two different
// numbered lists, accepted no PDF, told people elsewhere to post receipts in Slack, and
// gave someone who had not decided to buy no way to reach a person.
//
// Cost: no claim about who pays (Sam has not answered AUDIT N1). LICENSING_COST.short only.
// After the receipt is in, the applicant can self-report exam booked / passed / NPN
// (submit-licensing-milestone). Those are labelled self-reported server-side and never set
// license_status.

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, Lock, MessageSquare, PlayCircle, Sparkles, Upload } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBookingUrl,
  LICENSING_COST,
  LICENSING_COURSE_URL,
  SCHEDULING_LINKS,
} from "@/lib/apexConfig";
import { formatPhoneDisplay } from "@/lib/phone";

export interface OwnerContact {
  name: string;
  phone?: string | null;
  email?: string | null;
}

/** Galaxy's own line, already published across the site (Footer, CalendlyEmbed, ApplicantHome). */
const GALAXY_LINE: OwnerContact = { name: "Sam", phone: "+14697676068" };

/** Images (incl. HEIC from iPhones) and PDF receipts. Kept in sync with submit-licensing-proof EXT. */
const PROOF_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,application/pdf";
const PROOF_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "application/pdf"]);
const MAX_BYTES = 8 * 1024 * 1024;

type ProofState = "checking" | "idle" | "uploading" | "submitted" | "error";

/** The human path. Always rendered: before purchase, after an upload error, after upload. */
export function AskUsFirst({ owner }: { owner?: OwnerContact | null }) {
  const contact = owner && (owner.phone || owner.email) ? owner : GALAXY_LINE;
  const phoneDigits = contact.phone ? contact.phone.replace(/[^\d+]/g, "") : "";
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3 text-sm" data-testid="ask-us-first">
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <MessageSquare className="h-4 w-4 text-primary" /> Not ready to buy? Ask us first.
      </p>
      <p className="mt-1 text-muted-foreground">{LICENSING_COST.short}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {SCHEDULING_LINKS.questions ? (
          <a className="font-semibold text-primary underline-offset-2 hover:underline" href={SCHEDULING_LINKS.questions} target="_blank" rel="noopener noreferrer">
            Book a 10-minute questions call
          </a>
        ) : null}
        {phoneDigits ? (
          <>
            {/* contact-scheme-allow: an applicant reaching their own recruiter or Galaxy's published line from their own status page, native handoff is correct */}
            <a className="font-semibold text-primary underline-offset-2 hover:underline" href={`sms:${phoneDigits}`}>
              Text {contact.name} {formatPhoneDisplay(contact.phone)}
            </a>
            {/* contact-scheme-allow: an applicant reaching their own recruiter or Galaxy's published line from their own status page, native handoff is correct */}
            <a className="text-primary underline-offset-2 hover:underline" href={`tel:${phoneDigits}`}>
              Call
            </a>
          </>
        ) : null}
        {contact.email ? (
          // contact-scheme-allow: an applicant emailing their own recruiter from their own status page, native handoff is correct
          <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${contact.email}`}>
            Email {contact.name}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function StepRow({ n, title, done, locked, children }: { n: number; title: string; done?: boolean; locked?: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          done
            ? "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500"
            : "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary tabular-nums"
        }
        aria-hidden="true"
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold text-foreground">
          <span className="sr-only">Step {n}: </span>
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

export function LicensingProofStep({
  applicationId,
  firstName,
  lastName,
  videoHref = "/get-licensed#licensing-video",
  owner,
  intro,
}: {
  applicationId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  videoHref?: string;
  owner?: OwnerContact | null;
  intro?: string;
}) {
  const [state, setState] = useState<ProofState>(applicationId ? "checking" : "idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // On a /status revisit, don't make someone re-send a receipt they already sent.
  useEffect(() => {
    let cancelled = false;
    if (!applicationId) {
      setState("idle");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("has_licensing_proof" as never, { p_application_id: applicationId } as never);
        if (cancelled) return;
        if (!error && (data as { submitted?: boolean } | null)?.submitted) setState("submitted");
        else setState("idle");
      } catch { // empty-catch-allow:best-effort — fall back to the upload form
        if (!cancelled) setState("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const onFile = async (file: File | undefined) => {
    if (!file || !applicationId) return;
    const type = (file.type || "").toLowerCase();
    if (!PROOF_TYPES.has(type)) {
      setErrorMsg("Upload a screenshot (PNG, JPG, HEIC) or the PDF receipt.");
      setState("error");
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrorMsg("That file is over 8 MB. Try a smaller screenshot.");
      setState("error");
      return;
    }
    setState("uploading");
    setErrorMsg(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("submit-licensing-proof", {
        body: { application_id: applicationId, data: dataUrl, content_type: type },
      });
      if (error || (data as { error?: unknown } | null)?.error) {
        const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? "Upload failed. Try again, or ask us below.";
        setErrorMsg(msg);
        setState("error");
        return;
      }
      setState("submitted");
    } catch {
      setErrorMsg("Upload failed. Check your connection and try again, or ask us below.");
      setState("error");
    }
  };

  // Without an application id there is nothing to attach a receipt to, so the call is open.
  const callUnlocked = state === "submitted" || !applicationId;
  const bookingUrl = buildBookingUrl(SCHEDULING_LINKS.licensing, { applicationId, firstName, lastName });

  return (
    <section className="space-y-4 rounded-md border border-border/40 bg-muted/20 p-4 sm:p-5" aria-labelledby="licensing-path-title">
      <div>
        <p id="licensing-path-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your path to a license
        </p>
        {intro ? <p className="mt-1 text-sm text-muted-foreground">{intro}</p> : null}
      </div>

      <ol className="space-y-4">
        <StepRow n={1} title="Watch the 5-min licensing video">
          <a
            href={videoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            <PlayCircle className="h-4 w-4" /> Watch the 5-min licensing video
          </a>
        </StepRow>

        <StepRow n={2} title="Get the pre-licensing course">
          <p className="text-xs text-muted-foreground">
            Use the legal name on your ID. {LICENSING_COST.short}
          </p>
          <GradientButton asChild variant="outline" className="w-full" size="lg">
            <a href={LICENSING_COURSE_URL} target="_blank" rel="noopener noreferrer" className="block">
              <Sparkles className="mr-2 h-4 w-4" /> Get the course
            </a>
          </GradientButton>
        </StepRow>

        <StepRow n={3} title="Upload your receipt" done={state === "submitted"}>
          {state === "submitted" ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">Receipt received. The team can see it now.</p>
          ) : (
            <>
              <label className="block">
                <span className="sr-only">Upload your course receipt (image or PDF)</span>
                <input
                  type="file"
                  accept={PROOF_ACCEPT}
                  disabled={!applicationId || state === "uploading" || state === "checking"}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/15 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-foreground hover:file:bg-primary/25 disabled:opacity-50"
                />
              </label>
              {state === "uploading" ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Upload className="h-4 w-4" /> Uploading your receipt…
                </p>
              ) : null}
              {state === "error" ? (
                <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                  {errorMsg ?? "Something went wrong."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">A screenshot or the PDF receipt, under 8 MB.</p>
              )}
            </>
          )}
        </StepRow>

        <StepRow n={4} title="Book your licensing call" locked={!callUnlocked}>
          {callUnlocked ? (
            <GradientButton asChild className="h-14 w-full text-base" size="lg">
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="block">
                <Calendar className="mr-2 h-5 w-5" /> Book your licensing call
              </a>
            </GradientButton>
          ) : (
            <p className="text-xs text-muted-foreground">Unlocks the moment your receipt is in.</p>
          )}
        </StepRow>
      </ol>

      <AskUsFirst owner={owner} />

      {state === "submitted" && applicationId ? <LicensingSelfReport applicationId={applicationId} /> : null}
    </section>
  );
}

type ReportKind = "exam_scheduled" | "exam_passed" | "npn";

/** "I booked my exam" / "I passed" / "My NPN" — posts to submit-licensing-milestone. */
export function LicensingSelfReport({ applicationId }: { applicationId: string }) {
  const [examDate, setExamDate] = useState("");
  const [npn, setNpn] = useState("");
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [done, setDone] = useState<Partial<Record<ReportKind, boolean>>>({});
  const [message, setMessage] = useState<string | null>(null);

  const send = async (kind: ReportKind) => {
    setBusy(kind);
    setMessage(null);
    try {
      const body: Record<string, string> = { application_id: applicationId, kind };
      if (kind === "exam_scheduled") body.exam_date = examDate;
      if (kind === "npn") body.npn = npn;
      const { data, error } = await supabase.functions.invoke("submit-licensing-milestone", { body });
      const apiError = (data as { error?: { message?: string } } | null)?.error;
      if (error || apiError) {
        setMessage(apiError?.message ?? "That didn't save. Try again, or text us.");
      } else {
        setDone((d) => ({ ...d, [kind]: true }));
        setMessage("Saved. The team can see it.");
      }
    } catch {
      setMessage("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border/50 bg-background/40 p-3" data-testid="licensing-self-report">
      <p className="text-sm font-semibold text-foreground">After your call: tell us when things move</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Exam date
          <input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          disabled={!examDate || busy !== null || done.exam_scheduled}
          onClick={() => void send("exam_scheduled")}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          {done.exam_scheduled ? "Exam booked ✓" : "I booked my exam"}
        </button>
        <button
          type="button"
          disabled={busy !== null || done.exam_passed}
          onClick={() => void send("exam_passed")}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          {done.exam_passed ? "Passed ✓" : "I passed"}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          My NPN
          <input
            inputMode="numeric"
            value={npn}
            onChange={(e) => setNpn(e.target.value)}
            placeholder="5-10 digits"
            className="mt-1 block w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          disabled={npn.replace(/\D/g, "").length < 5 || busy !== null || done.npn}
          onClick={() => void send("npn")}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          {done.npn ? "NPN saved ✓" : "Save my NPN"}
        </button>
      </div>
      {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

export default LicensingProofStep;
