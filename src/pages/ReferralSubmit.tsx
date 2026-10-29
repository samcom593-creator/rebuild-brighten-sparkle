import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BadgeDollarSign, Check, ChevronDown, Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { celebrate, type CelebrationOrigin } from "@/lib/celebrate";
import { PageHeader } from "@/components/ui/page-header";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { US_STATES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";
import { MyLinkCard } from "@/components/invitations/MyLinkCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// PL-SAM-2026-06-03-008 wave-85: collapsed 8-field 4-grouped-section layout down
// to a single vertical 6-field stack. Removed license-status select (was always
// defaulting to "unknown" — we ask after first contact instead) and the
// "How do you know them?" relationship dropdown (zero signal upfront).
// Mobile-first vertical scan, one decision per line, ship in <30 seconds.
//
// Grow review 2026-10-28 (findings 30, 34): the page sits in the standard frame (PageHeader,
// no header button). The bonus is one quiet line in plain words, with no "AP". One control
// scale: the gold button is 48px, every other control is 44px, every word is at least 13px.
// A failed send says so on the page and keeps what was typed. The submit_referral RPC call
// is unchanged.
//
// OVERHAUL-1 (2026-10-29), Sam: "Give them an option: either put their first name, last name,
// email, NPN, phone number... Or an option, just click attach a link, and they just tap it."
// The page now leads with links, the way people actually recruit:
//   1. Your link: the permanent /r/<slug> link, Copy and Share, one tap (MyLinkCard).
//   2. Make a link: a prospect join link (/join/<token>) for one person, Quick link or With
//      details, Licensed or Not licensed yet, Permanent or Temporary, credited to you.
//   3. Rather we call them?: the referral form, folded, exactly as before inside. Opening it
//      hands the one gold button to Send referral; the link maker goes quiet.
//   4. Links you made: appears with the first link.
//
// Colour layer (docs/DESIGN_SYSTEM.md "Colour, motion and sound"): the header bubble is a gift
// in green (a referral is good news), the bonus line carries a gold bubble, and a sent referral
// chimes from the Send button and pops its confirmation in. A failed send plays nothing.
const schema = z
  .object({
    firstName: z.string().min(2, "Enter their first name (at least 2 letters)").max(50, "First name is too long (50 letters at most)"),
    lastName: z.string().min(2, "Enter their last name (at least 2 letters)").max(50, "Last name is too long (50 letters at most)"),
    email: z.string().email("That email does not look right").optional().or(z.literal("")),
    phone: z.string().optional(),
    state: z.string().min(2, "Choose their state"),
    notes: z.string().max(2000, "Notes are too long (2,000 characters at most)").optional(),
  })
  .refine(
    (v) => (v.email && v.email.length > 0) || (v.phone && v.phone.length >= 10),
    { message: "Add a phone number or an email so we can reach them", path: ["email"] },
  );

type FormData = z.infer<typeof schema>;

type Confirmation = {
  name: string;
  isDup: boolean;
  matchingApplicationId?: string | null;
};

/** Every field is 48px with 16px text at every width (Input drops to 14px from md up on its own). */
const FIELD_CLASS = "h-12 text-base md:text-base";

/**
 * Where the finger was, as a point, read before the send: the confirmation replaces the form,
 * so by the time the server answers the Send button is gone and a point still puts the bubbles
 * where it stood. The control itself while it has no size (hidden, or under test).
 */
function pressOrigin(control: Element | null): CelebrationOrigin {
  if (!control || typeof window === "undefined") return null;
  const r = control.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return control;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((r.left + r.width / 2) / window.innerWidth), y: clamp((r.top + r.height / 2) / window.innerHeight) };
}

function sentCopy(c: Confirmation): string {
  if (c.matchingApplicationId) {
    return "They had already applied on their own. You are logged as the referrer: if they reach $10,000 in annual premium, the $300 is yours.";
  }
  if (c.isDup) {
    return "We already had this person on file. Your referral is logged next to the earlier one.";
  }
  return "We make first contact within 24 hours. My Referrals shows where they stand.";
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export default function ReferralSubmit() {
  usePageTitle("Refer a recruit · Galaxy");
  const navigate = useNavigate();
  const { isAdmin, isManager } = useAuth();
  const linksHeading = isAdmin || isManager ? "Personal links" : "Links you made";
  const [callOpen, setCallOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const sendButton = useRef<HTMLButtonElement>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    // Every field starts as "" so zod reports all of the problems in one round. With State left
    // undefined the object parse aborted, and "phone or email" only appeared on a second submit.
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", state: "", notes: "" },
  });
  const { errors } = form.formState;
  const stateValue = form.watch("state");

  async function onSubmit(values: FormData) {
    setSubmitting(true);
    setSendError(null);
    // Read now, before the round trip, so the celebration rises from the button that was pressed.
    const origin = pressOrigin(sendButton.current);
    try {
      const { data, error } = await (supabase.rpc as any)("submit_referral", {
        p_first_name: values.firstName,
        p_last_name: values.lastName,
        p_email: values.email || null,
        p_phone: values.phone || null,
        p_state: values.state,
        p_license: "unknown",
        p_relationship: null,
        p_notes: values.notes ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setConfirmation({
        name: `${values.firstName} ${values.lastName}`,
        isDup: !!row?.is_duplicate,
        matchingApplicationId: row?.matching_application_id ?? null,
      });
      toast.success(
        row?.matching_application_id
          ? "They already applied. You are logged as the referrer."
          : row?.is_duplicate
            ? "We already had this person on file. Your referral is logged too."
            : "Referral sent. We make first contact within 24 hours.",
      );
      // The referral is on the list (an error threw above): bubbles and a chime from the Send button.
      void celebrate("booked", origin);
    } catch (err: any) {
      console.error("[referral.submit]", err);
      const message = typeof err?.message === "string" && err.message ? err.message : "the server did not answer";
      // The form keeps what was typed; the reason sits on the page, not only in a toast that fades.
      setSendError(message);
      toast.error("The referral did not send. What you typed is still here.");
    } finally {
      setSubmitting(false);
    }
  }

  function referAnother() {
    form.reset();
    setSendError(null);
    setConfirmation(null);
  }

  return (
    <div className="page-enter mx-auto w-full max-w-2xl space-y-5 pb-28">
      <PageHeader
        title="Refer a recruit"
        subtitle="Send your link, or make one for one person."
        icon={<Gift />}
        tone="good"
        // The gold button is the link maker's Make link (or Send referral once that is open).
        // Declaring null keeps the header empty and turns off the legacy inference.
        primaryAction={null}
      />

      <MyLinkCard blurb="Anyone who applies through it is credited to you." />

      {/* While the referral form is open it holds the page's one gold button. */}
      <InviteAgentForm kind="join" framed quiet={callOpen} />

      <section aria-labelledby="refer-call-title" className="rounded-xl border border-border bg-card" data-testid="refer-call">
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:px-5"
          aria-expanded={callOpen}
          aria-controls="refer-call-body"
          onClick={() => setCallOpen((open) => !open)}
        >
          <ToneBubble tone="gold" size="md">
            <BadgeDollarSign />
          </ToneBubble>
          <span className="min-w-0 flex-1">
            <span id="refer-call-title" className="block text-base font-semibold leading-6 text-foreground">Rather we call them?</span>
            <span className="block text-sm text-muted-foreground">Send their name and number. We call within 24 hours, and you can earn a $300 bonus.</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", callOpen && "rotate-180")} aria-hidden="true" />
        </button>

        {callOpen && (
          <div id="refer-call-body" className="space-y-5 border-t border-border px-4 pb-5 pt-4 sm:px-5">
            {confirmation ? (
              // Pops in once, the moment the server said yes.
              <div className="apex-pop space-y-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-tone-good">
                  <ToneBubble tone="good" size="sm">
                    <Check />
                  </ToneBubble>
                  Sent
                </p>
                <h2 className="text-xl font-semibold leading-7">{confirmation.name} is on our list.</h2>
                <p className="text-base text-muted-foreground">{sentCopy(confirmation)}</p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button className="h-12 text-base sm:flex-1" onClick={() => navigate("/dashboard/referrals/mine")}>
                    See my referrals
                  </Button>
                  <Button variant="outline" className="h-11 text-base sm:flex-1" onClick={referAnother}>
                    Refer someone else
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-base leading-snug text-muted-foreground" data-testid="referral-bonus">
                  <span className="font-semibold text-foreground">$300 referral bonus.</span> You get it once the person you
                  refer has sold $10,000 in annual premium (the yearly premium on the policies they sell). My Referrals shows
                  where each one stands.
                </p>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input
                        id="firstName"
                        className={FIELD_CLASS}
                        autoComplete="given-name"
                        aria-invalid={errors.firstName ? true : undefined}
                        aria-describedby={errors.firstName ? "firstName-error" : undefined}
                        {...form.register("firstName")}
                      />
                      <FieldError id="firstName-error" message={errors.firstName?.message} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input
                        id="lastName"
                        className={FIELD_CLASS}
                        autoComplete="family-name"
                        aria-invalid={errors.lastName ? true : undefined}
                        aria-describedby={errors.lastName ? "lastName-error" : undefined}
                        {...form.register("lastName")}
                      />
                      <FieldError id="lastName-error" message={errors.lastName?.message} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" inputMode="tel" className={FIELD_CLASS} autoComplete="tel" {...form.register("phone")} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      className={FIELD_CLASS}
                      autoComplete="email"
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={errors.email ? "email-help email-error" : "email-help"}
                      {...form.register("email")}
                    />
                    <p id="email-help" className="text-sm text-muted-foreground">
                      Phone or email. One is enough.
                    </p>
                    <FieldError id="email-error" message={errors.email?.message} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Select
                      value={stateValue}
                      onValueChange={(v) => form.setValue("state", v, { shouldValidate: true, shouldDirty: true })}
                    >
                      <SelectTrigger
                        id="state"
                        className={FIELD_CLASS}
                        aria-label="State"
                        aria-invalid={errors.state ? true : undefined}
                        aria-describedby={errors.state ? "state-error" : undefined}
                      >
                        <SelectValue placeholder="Choose a state" />
                      </SelectTrigger>
                      <SelectContent>
                        {US_STATES.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="h-11 text-base">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError id="state-error" message={errors.state?.message} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Textarea
                      id="notes"
                      rows={3}
                      className="min-h-[96px] text-base"
                      placeholder="Anything that helps: what they do now, why they would do well, the best time to call"
                      aria-invalid={errors.notes ? true : undefined}
                      aria-describedby={errors.notes ? "notes-error" : undefined}
                      {...form.register("notes")}
                    />
                    <FieldError id="notes-error" message={errors.notes?.message} />
                  </div>

                  {sendError && (
                    <p role="alert" className="text-sm text-destructive">
                      The referral did not send: {sendError}. What you typed is still here, so fix anything needed and try again.
                    </p>
                  )}

                  <Button ref={sendButton} type="submit" disabled={submitting} className="h-12 w-full text-base">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Sending…
                      </>
                    ) : (
                      "Send referral"
                    )}
                  </Button>
                </form>
              </>
            )}
          </div>
        )}
      </section>

      {/* An agent sees only the links they made; an admin or manager sees their team's too, so the
          heading says what the list is for each. */}
      <InvitationsTable kind="join" title={linksHeading} heading={linksHeading} hideWhenEmpty cardsOnly />
    </div>
  );
}
