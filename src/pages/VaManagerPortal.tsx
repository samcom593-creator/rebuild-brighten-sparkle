import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Loader2, Copy, RefreshCw, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { celebrate, type CelebrationOrigin } from "@/lib/celebrate";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/ui/delight/CountUp";
import { RevealList } from "@/components/ui/delight/Reveal";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { formatAgo, formatDay, formatSince } from "@/components/pipeline/worklist/worklistFormat";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

interface VaRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  disabled: boolean;
}

// No 0/O, 1/l/I: the password is read off a phone screen and typed by someone else.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 14;

/**
 * A random login password made in the browser with crypto.getRandomValues. Rejection
 * sampling keeps every character equally likely; the loop guarantees a lowercase letter,
 * an uppercase letter and a digit so any password rule the auth server holds is met.
 * Exported for the test; nothing else imports it.
 */
export function generateLoginPassword(length = PASSWORD_LENGTH): string {
  const size = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % size);
  const sample = (): string => {
    const out: string[] = [];
    const bytes = new Uint8Array(length * 2);
    while (out.length < length) {
      crypto.getRandomValues(bytes);
      for (const byte of bytes) {
        if (byte >= limit) continue;
        out.push(PASSWORD_ALPHABET[byte % size]);
        if (out.length === length) break;
      }
    }
    return out.join("");
  };
  let password = sample();
  while (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) password = sample();
  return password;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "unknown error";
}

/**
 * supabase.functions.invoke wraps every non-2xx answer in the one sentence "Edge Function
 * returned a non-2xx status code" and leaves the server's own words ("That email is already
 * registered.") in error.context, the Response. Read them out so the person sees the reason.
 */
async function invokeReason(error: { message: string; context?: unknown }): Promise<string> {
  const response = error.context as { json?: () => Promise<unknown> } | undefined;
  if (response && typeof response.json === "function") {
    try {
      const body = (await response.json()) as { error?: unknown } | null;
      if (body && typeof body.error === "string" && body.error) return body.error;
    } catch (readError) {
      // empty-catch-allow: the body was not JSON; the generic message below is the honest fallback
      void readError;
    }
  }
  return error.message || "unknown error";
}

/**
 * The account's state in words, with its tone from the shared vocabulary (src/lib/tones.ts,
 * 2026-10-28): an account that can sign in is going well; one turned off is quiet, the same
 * slate as Inactive on the Pipeline. The word is always beside the colour.
 */
const ACCOUNT_STATE_TONE: Record<"active" | "disabled", Tone> = { active: "good", disabled: "slate" };

function stateOf(row: VaRow): { label: string; tone: Tone } {
  return row.disabled
    ? { label: "Turned off", tone: ACCOUNT_STATE_TONE.disabled }
    : { label: "Active", tone: ACCOUNT_STATE_TONE.active };
}

/** Two initials for the bubble beside a name; the first letter of the email when there is no name. */
function initialsOf(row: VaRow): string {
  const fromName = (row.full_name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  return (fromName || (row.email ?? "").charAt(0) || "?").toUpperCase();
}

/** The person's initials in the colour of their state. Decoration: the name sits beside it and the pill says the word. */
function InitialsBubble({ row, className }: { row: VaRow; className?: string }) {
  const t = TONE_CLASS[stateOf(row).tone];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full border text-base font-bold leading-none", t.soft, t.text, t.border, className)}
    >
      {initialsOf(row)}
    </span>
  );
}

function StatePill({ row, className }: { row: VaRow; className?: string }) {
  const state = stateOf(row);
  return (
    <TonePill tone={state.tone} dot className={className}>
      {state.label}
    </TonePill>
  );
}

/**
 * Where the finger was, as a point, read before the round trip: the dialog swaps the form for
 * the created login, so the Create button is gone by the time the server answers and a point
 * still puts the bubbles where it stood. The control itself while it has no size (under test).
 */
function pressOrigin(control: Element | null): CelebrationOrigin {
  if (!control || typeof window === "undefined") return null;
  const r = control.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return control;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((r.left + r.width / 2) / window.innerWidth), y: clamp((r.top + r.height / 2) / window.innerHeight) };
}

function lastSignInSentence(row: VaRow): string {
  return row.last_sign_in_at ? `Last signed in ${formatSince(row.last_sign_in_at)}` : "Never signed in";
}

/** The one access control per row: outline, 44px, red words when it turns someone off. Two-step via the confirm. */
function AccessButton({ row, busy, onToggle, className }: { row: VaRow; busy: boolean; onToggle: (row: VaRow) => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() => onToggle(row)}
      className={cn("h-11 gap-1.5 px-4", !row.disabled && "text-destructive hover:bg-destructive/10 hover:text-destructive", className)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {row.disabled ? "Turn on" : "Turn off"}
    </Button>
  );
}

/**
 * /va-team — the VA Manager (Milver) portal, called "Staff accounts" on screen.
 * Create assistant logins, see when they last signed in, and turn access off or back on.
 * All writes go through the create-va-account / set-va-account edge functions,
 * which authenticate the caller from their JWT and scope every action to VAs
 * the caller manages (profiles.managed_by). list_my_vas() returns only own VAs.
 *
 * Grow review fixes (2026-10-28): the counts render only once the list has loaded, so a
 * failed or pending read is never "0 accounts" (31); the password is generated here with
 * crypto.getRandomValues, sent to create-va-account (which accepts any password of 6+
 * characters, per the recovered prod mirror) and shown exactly once (32); rows are cards
 * under sm and a table from sm up, with one 44px outline Turn off / Turn on button (33);
 * one control scale, h-12 primary and h-11 everything else, nothing under 13px (34).
 *
 * Colour layer (2026-10-28, docs/DESIGN_SYSTEM.md "Colour, motion and sound"): the header
 * bubble is cool (people being set up), each row opens with the person's initials in the
 * colour of their state, the state is a pill in words with that tone, the rows rise in once,
 * the counts tween when they change, a created login pops its bubbles from the Create button,
 * a copied password pops, and a changed access ticks. Nothing plays on load or on an error.
 */
export default function VaManagerPortal() {
  usePageTitle("Staff accounts · Galaxy");
  const { isAdmin, isVaManager } = useAuth();
  const askConfirm = useConfirm();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  const {
    data: vas,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["my-vas"],
    queryFn: async (): Promise<VaRow[]> => {
      const { data, error } = await (
        supabase.rpc as unknown as (fn: string) => Promise<{ data: VaRow[] | null; error: unknown }>
      )("list_my_vas");
      if (error) throw new Error(messageOf(error));
      return (data ?? []) as VaRow[];
    },
    enabled: isAdmin || isVaManager,
    staleTime: 30_000,
  });

  function openCreate() {
    setCreated(null);
    setFormError(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreated(null);
    setFormError(null);
    setCreateOpen(false);
  }

  /** `origin` is where Create login was pressed, read before the round trip (see pressOrigin). */
  async function handleCreate(origin: CelebrationOrigin) {
    const fullName = name.trim();
    const address = email.trim().toLowerCase();
    if (!fullName || !address) {
      setFormError("Enter their full name and email.");
      return;
    }
    setFormError(null);
    setCreating(true);
    const password = generateLoginPassword();
    try {
      const { data, error } = await supabase.functions.invoke("create-va-account", {
        body: { full_name: fullName, email: address, password },
      });
      if (error) throw new Error(await invokeReason(error));
      if (data?.error) throw new Error(String(data.error));
      // The server echoes the password it stored. Show that one: it is the truth, the local
      // value is only what was asked for.
      setCreated({
        email: typeof data?.email === "string" && data.email ? data.email : address,
        password: typeof data?.password === "string" && data.password ? data.password : password,
      });
      setName("");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["my-vas"] });
      toast.success("Login created.");
      // The login exists (a refusal threw above): a few bubbles and a pop from the button.
      void celebrate("save", origin);
    } catch (e) {
      const sentence = `The login was not created: ${messageOf(e)}.`;
      setFormError(sentence);
      toast.error(sentence);
    } finally {
      setCreating(false);
    }
  }

  async function toggleAccess(row: VaRow) {
    const turningOff = !row.disabled;
    const label = row.full_name || row.email || "this assistant";
    const ok = await askConfirm({
      title: turningOff ? `Turn off ${label}?` : `Turn ${label} back on?`,
      description: turningOff
        ? "They cannot sign in until you turn them back on."
        : "They can sign in again right away.",
      confirmText: turningOff ? "Turn off" : "Turn on",
      tone: turningOff ? "danger" : "primary",
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      const { data, error } = await supabase.functions.invoke("set-va-account", {
        body: { va_user_id: row.user_id, action: turningOff ? "disable" : "enable" },
      });
      if (error) throw new Error(await invokeReason(error));
      if (data?.error) throw new Error(String(data.error));
      await qc.invalidateQueries({ queryKey: ["my-vas"] });
      toast.success(turningOff ? `${label} is turned off.` : `${label} is back on.`);
      // Access moved: one quiet tick, only once the server said so.
      playSoundEffect("tick");
    } catch (e) {
      toast.error(`Access did not change: ${messageOf(e)}.`);
    } finally {
      setBusyId(null);
    }
  }

  async function copyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
      // The clipboard has it; a blocked clipboard lands in the catch, silent.
      playSoundEffect("pop");
      toast.success("Password copied.");
    } catch {
      toast.error("Copy is blocked here. Write the password down instead.");
    }
  }

  if (!isAdmin && !isVaManager) {
    return (
      <div className="p-8 text-center text-base text-muted-foreground">You don't have access to Staff accounts.</div>
    );
  }

  const rows = vas ?? [];
  const loaded = !isLoading && !error && vas !== undefined;
  const activeCount = rows.filter((v) => !v.disabled).length;
  const disabledCount = rows.length - activeCount;

  return (
    <div className="page-enter mx-auto w-full max-w-5xl space-y-5 pb-24">
      {/* Grow redesign (2026-10-28): one plain title, one gold button, counts in words. */}
      <PageHeader
        title="Staff accounts"
        // 35 characters: with the 48px bubble beside it, a 390px phone holds about 36 on one line (the
        // earlier 45-character sentence clamped to "…on or…" the moment the bubble arrived).
        subtitle="Add logins and turn them on or off."
        icon={<Users />}
        tone="cool"
        primaryAction={
          <Button size="lg" onClick={openCreate} className="h-12 gap-1.5 text-base">
            <UserPlus className="h-5 w-5" /> New assistant
          </Button>
        }
      />

      {/* The counts exist only once the list is in hand. A read that is still running or has
          failed shows no number at all: a 0 here would claim there are no accounts. */}
      {isLoading ? (
        <>
          <Skeleton className="h-6 w-56" />
          <p role="status" className="sr-only">Loading accounts.</p>
        </>
      ) : error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-destructive">The accounts did not load: {messageOf(error)}.</p>
          <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Retry
          </Button>
        </div>
      ) : loaded ? (
        // Each number tweens when it changes (CountUp); the first paint is the real number at once.
        <p className="text-base text-muted-foreground">
          <CountUp value={rows.length} className="font-semibold text-foreground" /> {rows.length === 1 ? "account" : "accounts"}
          {" · "}
          <CountUp value={activeCount} className={cn("font-semibold", TONE_CLASS[ACCOUNT_STATE_TONE.active].text)} /> active
          {disabledCount > 0 && (
            <>
              {" · "}
              <CountUp value={disabledCount} className={cn("font-semibold", TONE_CLASS[ACCOUNT_STATE_TONE.disabled].text)} /> turned off
            </>
          )}
        </p>
      ) : null}

      {isLoading ? (
        <GlassCard className="space-y-4 p-4">
          {[0, 1, 2].map((i) => (
            // stable-key-allow:skeleton — three identical placeholder lines, never reordered
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ))}
        </GlassCard>
      ) : loaded && rows.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <div className="mb-3 flex justify-center">
            <ToneBubble tone="cool" size="lg">
              <Users />
            </ToneBubble>
          </div>
          <p className="text-base text-muted-foreground">
            No assistants yet. Tap <span className="font-medium text-foreground">New assistant</span> to add the first login.
          </p>
        </GlassCard>
      ) : loaded ? (
        <GlassCard className="overflow-hidden p-0">
          {/* Phones: one card per person, rising in once. Nothing is truncated, so nothing is clipped at 390px. */}
          <RevealList as="ul" className="divide-y divide-border sm:hidden" aria-label="Assistant accounts">
            {rows.map((v) => (
              <li key={v.user_id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <InitialsBubble row={v} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-base font-semibold text-foreground">{v.full_name || "No name"}</p>
                    <p className="break-all text-sm text-muted-foreground">{v.email || "No email"}</p>
                  </div>
                  <StatePill row={v} className="shrink-0" />
                </div>
                <p className="text-sm text-muted-foreground">{lastSignInSentence(v)}</p>
                <AccessButton row={v} busy={busyId === v.user_id} onToggle={(row) => void toggleAccess(row)} className="w-full" />
              </li>
            ))}
          </RevealList>

          {/* From sm up: the same people as a table, Created only once there is room for it. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="h-11 px-4 font-medium">Name</th>
                  <th scope="col" className="h-11 px-4 font-medium">Email</th>
                  <th scope="col" className="hidden h-11 px-4 font-medium md:table-cell">Created</th>
                  <th scope="col" className="h-11 px-4 font-medium">Last sign-in</th>
                  <th scope="col" className="h-11 px-4 font-medium">Status</th>
                  <th scope="col" className="h-11 px-4 text-right font-medium">
                    <span className="sr-only">Access</span>
                  </th>
                </tr>
              </thead>
              <tbody className="apex-rise-list">
                {rows.map((v) => (
                  <tr key={v.user_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-base font-semibold text-foreground">
                      <span className="flex items-center gap-3">
                        <InitialsBubble row={v} className="h-10 w-10 text-sm" />
                        {v.full_name || "No name"}
                      </span>
                    </td>
                    <td className="break-all px-4 py-3 text-muted-foreground">{v.email || "No email"}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">{formatDay(v.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatAgo(v.last_sign_in_at)}</td>
                    <td className="px-4 py-3">
                      <StatePill row={v} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AccessButton row={v} busy={busyId === v.user_id} onToggle={(row) => void toggleAccess(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          // Closing mid-request would lose the only time the password is shown.
          if (!open && creating) return;
          if (open) setCreateOpen(true);
          else closeCreate();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? "Login created" : "Create an assistant login"}</DialogTitle>
            <DialogDescription>
              {created
                ? "Share this email and password with your assistant. They sign in at the login page."
                : "Your assistant signs in at the login page with this email and a password we make for them."}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            // Pops in once, the moment the server stored the login.
            <div className="apex-pop space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-tone-good">
                <ToneBubble tone="good" size="sm">
                  <Check />
                </ToneBubble>
                Ready to share
              </div>
              <dl className="space-y-3 rounded-md border border-border bg-card p-4">
                <div>
                  <dt className="text-sm text-muted-foreground">Email</dt>
                  <dd className="break-all text-base font-medium text-foreground">{created.email}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Password</dt>
                  <dd className="break-all font-mono text-lg font-semibold tracking-wide text-foreground">{created.password}</dd>
                </div>
              </dl>
              <Button type="button" variant="outline" className="h-11 w-full gap-1.5 sm:w-auto" onClick={() => void copyPassword()}>
                <Copy className="h-4 w-4" aria-hidden /> Copy password
              </Button>
              <p className="text-sm font-medium text-warning">This password will not be shown again. Copy it now or write it down.</p>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" className="h-12 text-base" onClick={closeCreate}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                // Read the button now, before the round trip, so the bubbles rise from it.
                void handleCreate(pressOrigin(createButton.current));
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="va-name">Full name</Label>
                <Input
                  id="va-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  className="h-12 text-base md:text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-email">Email</Label>
                <Input
                  id="va-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  inputMode="email"
                  className="h-12 text-base md:text-base"
                />
              </div>
              <p className="text-sm text-muted-foreground">We make the password. It is shown once, right after you tap Create login.</p>
              {formError ? (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" className="h-11" onClick={closeCreate} disabled={creating}>
                  Cancel
                </Button>
                <Button ref={createButton} type="submit" disabled={creating} className="h-12 gap-1.5 text-base">
                  {creating ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <UserPlus className="h-5 w-5" aria-hidden />}
                  Create login
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
