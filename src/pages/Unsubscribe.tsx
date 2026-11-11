/**
 * /unsubscribe?u=<encoded-email>: where every email's Unsubscribe link lands
 * (the unsubscribe edge function 302s its GET here).
 *
 * The opt-out is written only when the person presses the button, never on page
 * load: mail scanners open links, and an opt-out on load would unsubscribe people
 * who never clicked. The button POSTs to the same one-click endpoint mailbox
 * providers use. If the write fails the page says so and gives a manual path,
 * instead of claiming success.
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";

const FUNCTIONS_BASE =
  `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://xrzweoneiieddzxogewk.supabase.co"}/functions/v1`;
const MANUAL_ADDRESS = "info@kingofsales.net";

/** "jordan.smith@gmail.com" -> "j•••h@gmail.com"; anything that is not one address -> "". */
export function maskEmail(raw: string | null): string {
  if (!raw) return "";
  let email: string;
  try {
    email = decodeURIComponent(raw).trim();
  } catch {
    return "";
  }
  const m = /^([^\s@<>]+)@([^\s@<>]+\.[^\s@<>]+)$/.exec(email);
  if (!m) return "";
  const local = m[1];
  const shown = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${shown}@${m[2]}`;
}

type State = "idle" | "working" | "done" | "failed";

async function postOptOut(email: string): Promise<boolean> {
  const res = await fetch(`${FUNCTIONS_BASE}/unsubscribe?u=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { ok?: boolean } | null;
  return body?.ok === true;
}

export default function Unsubscribe() {
  usePageTitle("Unsubscribe");
  const [params] = useSearchParams();
  const raw = params.get("u");
  const masked = maskEmail(raw);
  const [state, setState] = useState<State>("idle");

  async function optOut() {
    if (!raw || !masked) return;
    setState("working");
    try {
      setState((await postOptOut(decodeURIComponent(raw).trim())) ? "done" : "failed");
    } catch (err) {
      // A network error or a non-JSON answer is a failure, and the page says so.
      console.warn("unsubscribe: request failed", err instanceof Error ? err.message : String(err));
      setState("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center">
      {!masked ? (
        <>
          <h1 className="text-2xl font-semibold">Unsubscribe</h1>
          <p className="mt-3 text-muted-foreground">
            This link is missing the address to remove. Email{" "}
            <a className="underline" href={`mailto:${MANUAL_ADDRESS}?subject=STOP`}>{MANUAL_ADDRESS}</a>{" "}
            with the word STOP and we will remove you.
          </p>
        </>
      ) : state === "done" ? (
        <>
          <h1 className="text-2xl font-semibold">You're unsubscribed</h1>
          <p className="mt-3 text-muted-foreground">
            {masked} won't get any more of these emails from Galaxy Financial.
          </p>
        </>
      ) : state === "failed" ? (
        <>
          <h1 className="text-2xl font-semibold">That didn't go through</h1>
          <p className="mt-3 text-muted-foreground">
            Email{" "}
            <a className="underline" href={`mailto:${MANUAL_ADDRESS}?subject=STOP`}>{MANUAL_ADDRESS}</a>{" "}
            with the word STOP and we will remove {masked} by hand.
          </p>
          <button type="button" onClick={optOut} className="mt-6 rounded-md border px-4 py-2 text-sm">
            Try again
          </button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Stop these emails?</h1>
          <p className="mt-3 text-muted-foreground">Galaxy Financial will stop emailing {masked}.</p>
          <button
            type="button"
            onClick={optOut}
            disabled={state === "working"}
            className="mt-6 rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
          >
            {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
          </button>
        </>
      )}
    </main>
  );
}
