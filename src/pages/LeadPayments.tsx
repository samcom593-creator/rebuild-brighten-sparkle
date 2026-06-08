import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  DollarSign,
  Filter,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { looseSupabase } from "@/lib/looseSupabase";

type LeadType = "A" | "B" | "C" | "Free";
type PaymentStatus = "pending" | "confirmed" | "waived" | "issue";

interface AgentOption {
  id: string;
  name: string;
  email: string | null;
}

interface PaymentRow {
  id: string;
  agent_id: string;
  week_start: string;
  tier: string;
  paid: boolean | null;
  marked_at: string | null;
  payment_method?: string | null;
  amount?: number | string | null;
  payment_date?: string | null;
  venmo_reference?: string | null;
  lead_type?: LeadType | string | null;
  assigned_rep?: string | null;
  notes?: string | null;
  payment_status?: PaymentStatus | string | null;
  payer_name?: string | null;
}

const LEAD_TYPES: LeadType[] = ["A", "B", "C", "Free"];
const STATUSES: PaymentStatus[] = ["pending", "confirmed", "waived", "issue"];

function weekStart(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00`);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function profileName(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const value = (profile as Record<string, unknown>).full_name;
  return typeof value === "string" && value.trim() ? value : null;
}

function profileEmail(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const value = (profile as Record<string, unknown>).email;
  return typeof value === "string" && value.trim() ? value : null;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toPaymentRow(row: Record<string, unknown>): PaymentRow {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    week_start: String(row.week_start),
    tier: String(row.tier ?? ""),
    paid: typeof row.paid === "boolean" ? row.paid : null,
    marked_at: stringOrNull(row.marked_at),
    payment_method: stringOrNull(row.payment_method),
    amount: typeof row.amount === "number" || typeof row.amount === "string" ? row.amount : null,
    payment_date: stringOrNull(row.payment_date),
    venmo_reference: stringOrNull(row.venmo_reference),
    lead_type: stringOrNull(row.lead_type),
    assigned_rep: stringOrNull(row.assigned_rep),
    notes: stringOrNull(row.notes),
    payment_status: stringOrNull(row.payment_status),
    payer_name: stringOrNull(row.payer_name),
  };
}

function rowAmount(row: PaymentRow): number {
  const n = Number(row.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rowLeadType(row: PaymentRow): LeadType {
  const raw = String(row.lead_type || row.tier || "").trim();
  if (raw.toLowerCase() === "free") return "Free";
  if (raw.toUpperCase() === "A") return "A";
  if (raw.toUpperCase() === "B") return "B";
  if (raw.toUpperCase() === "C") return "C";
  if (raw.toLowerCase() === "premium") return "A";
  return "B";
}

function rowStatus(row: PaymentRow): PaymentStatus {
  if (row.payment_status === "waived") return "waived";
  if (row.payment_status === "issue") return "issue";
  if (row.paid || row.payment_status === "confirmed") return "confirmed";
  return "pending";
}

export default function LeadPayments() {
  usePageTitle("Lead Payments · APEX");
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [leadTypeFilter, setLeadTypeFilter] = useState<"all" | LeadType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [form, setForm] = useState({
    agentId: "",
    leadType: "A" as LeadType,
    amount: "",
    paymentDate: todayIso(),
    venmoReference: "",
    assignedRep: "",
    notes: "",
    status: "confirmed" as PaymentStatus,
  });

  const agentsQ = useQuery({
    queryKey: ["lead-payments-agents"],
    enabled: !!user && isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentOption[]> => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("agents")
        .select("id, display_name, user_id, profile:profiles!agents_profile_id_fkey(full_name,email)")
        .eq("is_deactivated", false)
        .order("display_name", { ascending: true })
        .limit(800);
      if (error) throw error;
      return (data ?? [])
        .map((agent) => ({
          id: String(agent.id),
          name: profileName(agent.profile) || String(agent.display_name || "Unnamed agent"),
          email: profileEmail(agent.profile),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["lead-payments-ledger"],
    enabled: !!user && isAdmin,
    staleTime: 60_000,
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("lead_payment_tracking")
        .select("*")
        .order("marked_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map(toPaymentRow);
    },
  });

  const agentMap = useMemo(() => {
    return new Map((agentsQ.data ?? []).map((agent) => [agent.id, agent]));
  }, [agentsQ.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (paymentsQ.data ?? []).filter((row) => {
      const agent = agentMap.get(row.agent_id);
      const type = rowLeadType(row);
      const status = rowStatus(row);
      if (leadTypeFilter !== "all" && type !== leadTypeFilter) return false;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        row.payer_name,
        agent?.name,
        agent?.email,
        row.venmo_reference,
        row.assigned_rep,
        row.notes,
        type,
        status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agentMap, leadTypeFilter, paymentsQ.data, search, statusFilter]);

  const summary = useMemo(() => {
    const confirmed = filtered.filter((row) => rowStatus(row) === "confirmed");
    const pending = filtered.filter((row) => rowStatus(row) === "pending");
    const waived = filtered.filter((row) => rowStatus(row) === "waived");
    const total = confirmed.reduce((sum, row) => sum + rowAmount(row), 0);
    const byType = LEAD_TYPES.map((type) => ({
      type,
      count: filtered.filter((row) => rowLeadType(row) === type).length,
      total: filtered.filter((row) => rowLeadType(row) === type).reduce((sum, row) => sum + rowAmount(row), 0),
    }));
    return { confirmed: confirmed.length, pending: pending.length, waived: waived.length, total, byType };
  }, [filtered]);

  const savePayment = useMutation({
    mutationFn: async () => {
      if (!form.agentId) throw new Error("Choose the payer/agent first.");
      const agent = agentMap.get(form.agentId);
      const amount = form.leadType === "Free" ? 0 : Number(form.amount || 0);
      if (form.leadType !== "Free" && (!Number.isFinite(amount) || amount <= 0)) {
        throw new Error("Enter the Venmo amount.");
      }
      if (form.status === "confirmed" && form.leadType !== "Free" && !form.venmoReference.trim()) {
        throw new Error("Add the Venmo confirmation or reference.");
      }
      const paid = form.status === "confirmed" || form.status === "waived" || form.leadType === "Free";
      const payload = {
        agent_id: form.agentId,
        week_start: weekStart(form.paymentDate),
        tier: form.leadType.toLowerCase(),
        paid,
        marked_by: user?.id ?? null,
        marked_at: new Date().toISOString(),
        payment_method: "venmo",
        amount,
        payment_date: form.paymentDate,
        venmo_reference: form.venmoReference.trim() || null,
        lead_type: form.leadType,
        assigned_rep: form.assignedRep.trim() || null,
        notes: form.notes.trim() || null,
        payment_status: form.leadType === "Free" ? "waived" : form.status,
        payer_name: agent?.name ?? null,
      };
      const { error } = await looseSupabase
        .from("lead_payment_tracking")
        .upsert(payload, { onConflict: "agent_id,week_start,tier" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venmo lead payment saved");
      setForm((prev) => ({
        ...prev,
        amount: "",
        venmoReference: "",
        notes: "",
        status: "confirmed",
      }));
      qc.invalidateQueries({ queryKey: ["lead-payments-ledger"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ row, status }: { row: PaymentRow; status: PaymentStatus }) => {
      const paid = status === "confirmed" || status === "waived";
      const { error } = await looseSupabase
        .from("lead_payment_tracking")
        .update({
          paid,
          payment_status: status,
          marked_at: new Date().toISOString(),
          marked_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-payments-ledger"] });
      toast.success("Payment status updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Admin access is required for lead payment tracking.
      </div>
    );
  }

  return (
    <div className="page-enter px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Finance · Leads"
        eyebrowIcon={<Wallet className="h-3 w-3" />}
        title="Lead Payments"
        subtitle="Venmo-only payment ledger for A, B, C, and Free lead packs. Stripe is intentionally not an active path here."
        accent="emerald"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => paymentsQ.refetch()}
            disabled={paymentsQ.isFetching}
          >
            <RefreshCw className={cn("mr-1 h-4 w-4", paymentsQ.isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard icon={DollarSign} label="Confirmed Venmo" value={money(summary.total)} sub={`${summary.confirmed} confirmed payments`} />
        <SummaryCard icon={Receipt} label="Pending" value={String(summary.pending)} sub="Needs Venmo confirmation" />
        <SummaryCard icon={CheckCircle2} label="Waived / Free" value={String(summary.waived)} sub="Free lead packs or comped" />
        <SummaryCard icon={Filter} label="Shown" value={String(filtered.length)} sub="After filters" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="border-border/60 bg-card/80">
          <CardHeader>
            <CardTitle className="text-base">Add Venmo Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={form.agentId} onValueChange={(value) => setForm((prev) => ({ ...prev, agentId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder={agentsQ.isLoading ? "Loading agents..." : "Payer / agent"} />
              </SelectTrigger>
              <SelectContent>
                {(agentsQ.data ?? []).map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <Select value={form.leadType} onValueChange={(value) => setForm((prev) => ({ ...prev, leadType: value as LeadType, amount: value === "Free" ? "" : prev.amount }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_TYPES.map((type) => <SelectItem key={type} value={type}>Lead type {type}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.status} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value as PaymentStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={form.amount}
                disabled={form.leadType === "Free"}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
              <Input
                type="date"
                value={form.paymentDate}
                onChange={(event) => setForm((prev) => ({ ...prev, paymentDate: event.target.value }))}
              />
            </div>

            <Input
              placeholder="Venmo confirmation / reference"
              value={form.venmoReference}
              onChange={(event) => setForm((prev) => ({ ...prev, venmoReference: event.target.value }))}
            />
            <Input
              placeholder="Assigned rep"
              value={form.assignedRep}
              onChange={(event) => setForm((prev) => ({ ...prev, assignedRep: event.target.value }))}
            />
            <Textarea
              placeholder="Notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <Button className="w-full" onClick={() => savePayment.mutate()} disabled={savePayment.isPending}>
              {savePayment.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
              Save Venmo Payment
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/80">
          <CardHeader className="gap-3 border-b border-border/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-base">Payment Ledger</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search payer, ref, rep..."
                    className="h-9 pl-8 sm:w-64"
                  />
                </div>
                <Select value={leadTypeFilter} onValueChange={(value) => setLeadTypeFilter(value as "all" | LeadType)}>
                  <SelectTrigger className="h-9 sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {LEAD_TYPES.map((type) => <SelectItem key={type} value={type}>Type {type}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | PaymentStatus)}>
                  <SelectTrigger className="h-9 sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    {STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {summary.byType.map((item) => (
                <div key={item.type} className="rounded-md border border-border/50 bg-background/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Type {item.type}</p>
                  <p className="text-sm font-semibold">{item.count} · {money(item.total)}</p>
                </div>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {paymentsQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading payment ledger...
              </div>
            ) : paymentsQ.error ? (
              <div className="p-5 text-sm text-destructive">
                Lead payments could not load: {paymentsQ.error instanceof Error ? paymentsQ.error.message : "Unknown error"}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Receipt className="h-6 w-6" />} title="No lead payments match this view" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Payer</TableHead>
                    <TableHead>Lead type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Venmo reference</TableHead>
                    <TableHead>Payment date</TableHead>
                    <TableHead>Assigned rep</TableHead>
                    <TableHead className="text-right">Quick update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const agent = agentMap.get(row.agent_id);
                    const type = rowLeadType(row);
                    const status = rowStatus(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium">{row.payer_name || agent?.name || "Unknown agent"}</div>
                          <div className="text-xs text-muted-foreground">{agent?.email || row.agent_id}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">Type {type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              status === "confirmed" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
                              status === "pending" && "border-amber-400/40 bg-amber-400/10 text-amber-300",
                              status === "issue" && "border-rose-400/40 bg-rose-400/10 text-rose-300",
                            )}
                          >
                            {status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{money(rowAmount(row))}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{row.venmo_reference || "—"}</TableCell>
                        <TableCell>{row.payment_date ? format(new Date(`${row.payment_date}T12:00:00`), "MMM d, yyyy") : "—"}</TableCell>
                        <TableCell>{row.assigned_rep || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Select
                            value={status}
                            onValueChange={(value) => updateStatus.mutate({ row, status: value as PaymentStatus })}
                            disabled={updateStatus.isPending}
                          >
                            <SelectTrigger className="ml-auto h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((next) => <SelectItem key={next} value={next}>{next}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-400/10 text-emerald-400">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}
