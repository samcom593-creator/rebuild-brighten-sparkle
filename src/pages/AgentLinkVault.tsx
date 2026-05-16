/**
 * AgentLink Vault — admin-only view of the full agency book mirrored from
 * AgentLink/InsuraCloud. Every panel reads directly from Supabase tables
 * we populate via the cookie-pull sync, so if AgentLink goes silent the
 * data stays live here.
 *
 * Access: admin only. RLS on the underlying tables enforces this server-side;
 * the page also short-circuits below for non-admin viewers.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  Users,
  FileText,
  ScrollText,
  Briefcase,
  Search,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

type AnyRow = Record<string, unknown>;

function fmtMoney(n: unknown): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtDate(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString();
}
function fmtAge(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const ms = Date.now() - new Date(s).getTime();
  if (!Number.isFinite(ms)) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function matches(haystack: unknown, q: string): boolean {
  if (!q) return true;
  return String(haystack ?? "").toLowerCase().includes(q.toLowerCase());
}

// ─── Overview ──────────────────────────────────────────────────────────────
function OverviewPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["alvault-overview"],
    queryFn: async () => {
      const [deals, clients, contracts, agents, carriers, vault] = await Promise.all([
        supabase.from("deals").select("id, annual_premium, status, source").eq("source", "agent_link"),
        supabase.from("agentlink_clients" as any).select("id"),
        supabase.from("agentlink_contracts" as any).select("id, status"),
        supabase.from("agentlink_agents" as any).select("id, is_producer_active"),
        supabase.from("carriers").select("id"),
        supabase.from("agentlink_raw_exports" as any).select("id, endpoint, captured_at").order("captured_at", { ascending: false }).limit(1),
      ]);
      const dealRows = (deals.data as AnyRow[] | null) ?? [];
      const visible = dealRows.filter((d) => d.status === "submitted" || d.status === "active");
      return {
        deals_total: dealRows.length,
        deals_visible: visible.length,
        total_alp: visible.reduce((s, d) => s + Number(d.annual_premium ?? 0), 0),
        clients: clients.data?.length ?? 0,
        contracts: contracts.data?.length ?? 0,
        contracts_active: ((contracts.data as AnyRow[] | null) ?? []).filter((c) => c.status === "active").length,
        agents: agents.data?.length ?? 0,
        agents_active: ((agents.data as AnyRow[] | null) ?? []).filter((a) => a.is_producer_active === true).length,
        carriers: carriers.data?.length ?? 0,
        last_vault_capture: ((vault.data as AnyRow[] | null) ?? [])[0]?.captured_at,
      };
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <PageLoadingSkeleton />;
  const cards = [
    { label: "Deals (all statuses)", value: data.deals_total.toLocaleString(), icon: FileText },
    { label: "Visible deals (submitted+active)", value: data.deals_visible.toLocaleString(), icon: FileText },
    { label: "Total ALP", value: fmtMoney(data.total_alp), icon: Briefcase },
    { label: "Clients mirrored", value: data.clients.toLocaleString(), icon: Users },
    { label: "Contracts (writing numbers)", value: `${data.contracts.toLocaleString()} (${data.contracts_active.toLocaleString()} active)`, icon: ScrollText },
    { label: "Downline agents", value: `${data.agents.toLocaleString()} (${data.agents_active.toLocaleString()} active)`, icon: Users },
    { label: "Carriers", value: data.carriers.toLocaleString(), icon: Database },
    { label: "Last vault capture", value: fmtAge(data.last_vault_capture), icon: RefreshCw },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Source: AgentLink cookie pull (every minute) + raw vault snapshots. All numbers update without page refresh.
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" /> Refresh</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><c.icon className="h-3 w-3" /> {c.label}</div>
              <div className="text-2xl font-bold mt-1">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Agents ───────────────────────────────────────────────────────────────
function AgentsPanel() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["alvault-agents"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_agents" as any)
        .select("insuracloud_user_id, email, first_name, last_name, phone_number, npn_number, account_status, is_producer_active, state, contract_count, team_size, joined_date, last_sign_in_at, ssn_last4, date_of_birth")
        .order("last_name", { ascending: true });
      return (data as AnyRow[] | null) ?? [];
    },
  });
  const rows = useMemo(() => (data ?? []).filter((r) =>
    !q || matches(r.email, q) || matches(r.first_name, q) || matches(r.last_name, q) || matches(r.npn_number, q) || matches(r.state, q),
  ), [data, q]);
  if (isLoading) return <PageLoadingSkeleton />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, email, NPN, state…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Badge variant="outline">{rows.length} agents</Badge>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left p-2">Agent</th>
              <th className="text-left p-2">Phone</th>
              <th className="text-left p-2">NPN</th>
              <th className="text-left p-2">State</th>
              <th className="text-left p-2">Status</th>
              <th className="text-right p-2">Contracts</th>
              <th className="text-right p-2">Team</th>
              <th className="text-left p-2">Joined</th>
              <th className="text-left p-2">SSN last4 / DOB</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={String(r.insuracloud_user_id)} className="hover:bg-muted/30">
                <td className="p-2">
                  <div className="font-medium">{String(r.first_name ?? "")} {String(r.last_name ?? "")}</div>
                  <div className="text-xs text-muted-foreground">{String(r.email ?? "")}</div>
                </td>
                <td className="p-2 text-xs">{String(r.phone_number ?? "—")}</td>
                <td className="p-2 text-xs font-mono">{String(r.npn_number ?? "—")}</td>
                <td className="p-2 text-xs">{String(r.state ?? "—")}</td>
                <td className="p-2"><Badge variant={r.is_producer_active ? "default" : "secondary"} className="text-[10px]">{String(r.account_status ?? "—")}</Badge></td>
                <td className="p-2 text-right">{String(r.contract_count ?? 0)}</td>
                <td className="p-2 text-right">{String(r.team_size ?? 0)}</td>
                <td className="p-2 text-xs">{fmtDate(r.joined_date)}</td>
                <td className="p-2 text-xs font-mono">
                  {r.ssn_last4 ? `***-**-${String(r.ssn_last4)}` : "—"}{r.date_of_birth ? ` · ${fmtDate(r.date_of_birth)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Clients ──────────────────────────────────────────────────────────────
function ClientsPanel() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["alvault-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_clients" as any)
        .select("insuracloud_pipeline_client_id, first_name, last_name, phone, email, date_of_birth, pipeline_stage, insuracloud_user_id, agent_id")
        .order("last_name", { ascending: true })
        .limit(2000);
      return (data as AnyRow[] | null) ?? [];
    },
  });
  const rows = useMemo(() => (data ?? []).filter((r) =>
    !q || matches(r.first_name, q) || matches(r.last_name, q) || matches(r.phone, q) || matches(r.email, q),
  ), [data, q]);
  if (isLoading) return <PageLoadingSkeleton />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search clients by name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Badge variant="outline">{rows.length} of {data?.length ?? 0}</Badge>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left p-2">Client</th>
              <th className="text-left p-2">Phone</th>
              <th className="text-left p-2">Email</th>
              <th className="text-left p-2">DOB</th>
              <th className="text-left p-2">Stage</th>
              <th className="text-left p-2">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 500).map((r) => (
              <tr key={String(r.insuracloud_pipeline_client_id)} className="hover:bg-muted/30">
                <td className="p-2">{String(r.first_name ?? "")} {String(r.last_name ?? "")}</td>
                <td className="p-2 text-xs font-mono">{String(r.phone ?? "—")}</td>
                <td className="p-2 text-xs">{String(r.email ?? "—")}</td>
                <td className="p-2 text-xs">{fmtDate(r.date_of_birth)}</td>
                <td className="p-2"><Badge variant="outline" className="text-[10px]">{String(r.pipeline_stage ?? "—")}</Badge></td>
                <td className="p-2 text-xs">{String(r.insuracloud_user_id ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && (
          <div className="p-3 text-xs text-muted-foreground text-center">
            Showing first 500 of {rows.length}. Refine search to narrow.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Contracts ────────────────────────────────────────────────────────────
function ContractsPanel() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["alvault-contracts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_contracts" as any)
        .select("insuracloud_contract_id, writing_number, secondary_writing_number, contract_number, status, commission_level, activated_date, insuracloud_user_id, insuracloud_carrier_id")
        .order("activated_date", { ascending: false, nullsFirst: false })
        .limit(2000);
      return (data as AnyRow[] | null) ?? [];
    },
  });
  const rows = useMemo(() => (data ?? []).filter((r) =>
    !q || matches(r.writing_number, q) || matches(r.contract_number, q) || matches(r.commission_level, q),
  ), [data, q]);
  if (isLoading) return <PageLoadingSkeleton />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search writing number, contract number, commission level…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Badge variant="outline">{rows.length} contracts</Badge>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left p-2">Writing #</th>
              <th className="text-left p-2">Secondary</th>
              <th className="text-left p-2">Contract #</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Commission Level</th>
              <th className="text-left p-2">Activated</th>
              <th className="text-left p-2">Agent ID</th>
              <th className="text-left p-2">Carrier ID</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 500).map((r) => (
              <tr key={String(r.insuracloud_contract_id)} className="hover:bg-muted/30">
                <td className="p-2 text-xs font-mono">{String(r.writing_number ?? "—")}</td>
                <td className="p-2 text-xs font-mono">{String(r.secondary_writing_number ?? "—")}</td>
                <td className="p-2 text-xs font-mono">{String(r.contract_number ?? "—")}</td>
                <td className="p-2"><Badge variant={r.status === "active" ? "default" : "secondary"} className="text-[10px]">{String(r.status ?? "—")}</Badge></td>
                <td className="p-2 text-xs">{String(r.commission_level ?? "—")}</td>
                <td className="p-2 text-xs">{fmtDate(r.activated_date)}</td>
                <td className="p-2 text-xs">{String(r.insuracloud_user_id ?? "—")}</td>
                <td className="p-2 text-xs">{String(r.insuracloud_carrier_id ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && (
          <div className="p-3 text-xs text-muted-foreground text-center">
            Showing first 500 of {rows.length}.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Binary documents (admin) ─────────────────────────────────────────────
function BinariesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["alvault-binaries"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_binary_docs" as any)
        .select("id, doc_kind, content_type, byte_size, captured_at, agent_id, insuracloud_user_id")
        .order("captured_at", { ascending: false });
      return (data as AnyRow[] | null) ?? [];
    },
  });
  const download = async (id: string, kind: string, ct: string) => {
    const { data, error } = await supabase
      .from("agentlink_binary_docs" as any)
      .select("payload_b64")
      .eq("id", id)
      .maybeSingle();
    if (error || !(data as AnyRow | null)?.payload_b64) return;
    const b64 = (data as AnyRow).payload_b64 as string;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: ct || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}.${ct.includes("pdf") ? "pdf" : ct.includes("jpeg") ? "jpg" : "bin"}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (isLoading) return <PageLoadingSkeleton />;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Mirrored compliance documents pulled from AgentLink. Admin-only.
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left p-2">Document</th>
              <th className="text-left p-2">Type</th>
              <th className="text-right p-2">Size</th>
              <th className="text-left p-2">Captured</th>
              <th className="text-left p-2">Agent</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(data ?? []).map((r) => (
              <tr key={String(r.id)} className="hover:bg-muted/30">
                <td className="p-2 text-sm">{String(r.doc_kind ?? "")}</td>
                <td className="p-2 text-xs">{String(r.content_type ?? "")}</td>
                <td className="p-2 text-right text-xs">{Number(r.byte_size ?? 0).toLocaleString()} B</td>
                <td className="p-2 text-xs">{fmtAge(r.captured_at)}</td>
                <td className="p-2 text-xs">{String(r.insuracloud_user_id ?? "")}</td>
                <td className="p-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => download(String(r.id), String(r.doc_kind), String(r.content_type ?? ""))}>
                    Download
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Raw vault ────────────────────────────────────────────────────────────
function VaultPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["alvault-raw"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_raw_exports" as any)
        .select("id, endpoint, upstream_status, row_count, captured_at, sync_run_id")
        .order("captured_at", { ascending: false })
        .limit(500);
      return (data as AnyRow[] | null) ?? [];
    },
  });
  if (isLoading) return <PageLoadingSkeleton />;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Audit ledger — every successful upstream JSON response is captured here for forensic reconstruction.
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left p-2">Endpoint</th>
              <th className="text-left p-2">Status</th>
              <th className="text-right p-2">Rows</th>
              <th className="text-left p-2">Captured</th>
              <th className="text-left p-2">Sync run</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(data ?? []).map((r) => (
              <tr key={String(r.id)} className="hover:bg-muted/30">
                <td className="p-2 text-xs font-mono">{String(r.endpoint ?? "—")}</td>
                <td className="p-2 text-xs">{String(r.upstream_status ?? "—")}</td>
                <td className="p-2 text-right text-xs">{String(r.row_count ?? "—")}</td>
                <td className="p-2 text-xs">{fmtAge(r.captured_at)}</td>
                <td className="p-2 text-xs font-mono">{String(r.sync_run_id ?? "—").slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
// Route is gated by <ProtectedRoute requireAdmin> in App.tsx, so we skip
// an in-component admin-check screen — if you're here, you're authorized.
// RLS on every underlying table is the real server-side guarantee.
export default function AgentLinkVault() {
  usePageTitle("AgentLink Vault · APEX");
  const { isLoading: authLoading } = useAuth();
  if (authLoading) return <PageLoadingSkeleton />;
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Database className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Admin · Data Recovery</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">AgentLink Vault</h1>
          <p className="text-sm text-muted-foreground">
            Full agency book mirrored from AgentLink/InsuraCloud. If upstream goes silent, every record lives here.
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 gap-1 mb-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="binaries">Binaries</TabsTrigger>
          <TabsTrigger value="vault">Raw Vault</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewPanel /></TabsContent>
        <TabsContent value="agents"><AgentsPanel /></TabsContent>
        <TabsContent value="clients"><ClientsPanel /></TabsContent>
        <TabsContent value="contracts"><ContractsPanel /></TabsContent>
        <TabsContent value="binaries"><BinariesPanel /></TabsContent>
        <TabsContent value="vault"><VaultPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
