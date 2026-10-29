// CallClientPanel: everything a call picked up about the client, one tap away (MP-310, 2026-10-28).
//
// Sam: "see the client they talk to, and make it easy to click a button to show all the client's data that was picked
// up from the call, so it's easy to call back and fix those deals that didn't go through or fell through because of
// something small." Reads v_call_client (security_invoker): the dialer's lead fields, the booking packet when the call
// sold (Sam and Aisha only by RLS), and the resell read. A number that asked not to be called is shown, never linked.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, Phone, UserRound } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";

interface Beneficiary { name?: string; relationship?: string; pct?: number | string }
interface ClientRow {
  call_id: string;
  disposition: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_phone10: string | null;
  lead_email: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_dob: string | null;
  client_phone: string | null;
  client_email: string | null;
  client_street: string | null;
  client_city: string | null;
  client_state: string | null;
  client_zip: string | null;
  carrier: string | null;
  product: string | null;
  face_amount: number | null;
  monthly_premium: number | null;
  draft_day: string | null;
  payment_method_type: string | null;
  bank_name: string | null;
  policy_number: string | null;
  beneficiaries: Beneficiary[] | null;
  health_notes: string | null;
  tobacco: boolean | null;
  missing_fields: string[] | null;
  call_summary: string | null;
  ssn_last4: string | null;
  resell_angle: string | null;
  approval_status: string | null;
  gave_ssn: boolean | null;
  gave_bank: boolean | null;
  spouse_coverage: boolean | null;
  mortgage_protection: boolean | null;
  other_opportunities: string[] | null;
  do_not_call: boolean | null;
}

const money = (n: number | null) => (n == null ? null : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }));

function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  if (v == null || v === "") return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}

export function CallClientPanel({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["call-client", callId],
    enabled: open,
    staleTime: 60_000,
    queryFn: async (): Promise<ClientRow | null> => {
      const { data, error } = await (looseSupabase.from("v_call_client").select("*").eq("call_id", callId).limit(1) as unknown as Promise<{ data: ClientRow[] | null; error: Error | null }>);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const c = q.data;
  const name = c ? [c.client_first_name ?? c.lead_first_name, c.client_last_name ?? c.lead_last_name].filter(Boolean).join(" ") : "";
  const phone = c ? c.client_phone || c.lead_phone10 : null;
  const href = c && !c.do_not_call && phone ? phoneHref(phone) : null;
  const sold = c?.disposition === "Completed Sale";
  const objection = ["Bank Objection", "No Bank Account", "Social Objection"].includes(c?.disposition ?? "");
  const more = c ? [c.spouse_coverage ? "spouse" : "", c.mortgage_protection ? "mortgage" : "", ...(c.other_opportunities ?? [])].filter(Boolean) : [];
  return (
    <div className="rounded-lg border border-border/60">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold">
        <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /> Client from this call</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2 text-sm">
          {q.isLoading ? (
            <p className="text-muted-foreground">Loading the client…</p>
          ) : q.isError ? (
            <p className="text-rose-700 dark:text-rose-300">Client details did not load: {(q.error as Error).message}</p>
          ) : !c ? (
            <p className="text-muted-foreground">No client details on file for this call.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{name || "Name not on file"}</span>
                {href ? (
                  <a href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(phone ?? "")}</a>
                ) : phone ? (
                  <span className="text-muted-foreground">{formatPhoneDisplay(phone)}{c.do_not_call ? " · asked not to be called" : ""}</span>
                ) : null}
                {(c.client_email || c.lead_email) && <span className="text-muted-foreground [overflow-wrap:anywhere]">{c.client_email || c.lead_email}</span>}
              </div>
              {(c.call_summary || c.resell_angle) && <p>{c.call_summary || c.resell_angle}</p>}
              {c.call_summary && c.resell_angle && <p><span className="font-semibold">Angle:</span> {c.resell_angle}</p>}
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Fact k="Date of birth" v={c.client_dob} />
                <Fact k="Address" v={[c.client_street, c.client_city, [c.client_state, c.client_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />
                <Fact k="Carrier" v={c.carrier} />
                <Fact k="Product" v={c.product} />
                <Fact k="Coverage" v={money(c.face_amount)} />
                <Fact k="Premium" v={c.monthly_premium == null ? null : `${money(c.monthly_premium)}/mo`} />
                <Fact k="Draft day" v={c.draft_day} />
                <Fact k="Pays with" v={[c.payment_method_type, c.bank_name].filter(Boolean).join(" · ")} />
                <Fact k="Policy #" v={c.policy_number} />
                <Fact k="SSN" v={c.ssn_last4 ? `ends in ${c.ssn_last4}` : null} />
                <Fact k="Tobacco" v={c.tobacco == null ? null : c.tobacco ? "Yes" : "No"} />
                <Fact k="Health" v={c.health_notes} />
                <Fact k="Agent said" v={c.approval_status && c.approval_status !== "not_said" ? c.approval_status : null} />
                <Fact k="Gave on the call" v={[c.gave_ssn ? "SSN" : "", c.gave_bank ? "bank" : ""].filter(Boolean).join(" and ") || null} />
              </dl>
              {(c.beneficiaries ?? []).length > 0 && (
                <p><span className="font-semibold">Beneficiaries:</span> {(c.beneficiaries ?? []).map((b) => [b.name, b.relationship, b.pct != null ? `${b.pct}%` : ""].filter(Boolean).join(" ")).join("; ")}</p>
              )}
              {(c.missing_fields ?? []).length > 0 && <p className="text-amber-700 dark:text-amber-300">Still needed: {(c.missing_fields ?? []).join(", ")}</p>}
              {more.length > 0 && <p><span className="font-semibold">More coverage they wanted:</span> {more.join("; ")}</p>}
              {sold && <Link to={`/dashboard/sold-calls?call=${callId}`} className="text-primary hover:underline">Open the full packet in Sold Calls (SSN and bank)</Link>}
              {objection && <Link to={`/dashboard/sold-calls?view=objections&call=${callId}`} className="text-primary hover:underline">Open in Sold Calls, Bank and SSN objections</Link>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
