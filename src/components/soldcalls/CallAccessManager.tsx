// CallAccessManager — the admin lever behind can_view_sold_calls() (MP-CALL-ACCESS, 2026-11-08).
// Grants live in call_access_grants; RLS lets only admins write, so the buttons here are the
// whole control surface — no deploy to grant or revoke. A row opens the agent-call family
// (sold calls + packets incl. SSN/bank numbers, ReadyMode call audio, coaching, call training,
// Ayro book, easy resells), which is why every row carries a note saying who and why.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

interface GrantRow { user_id: string; note: string | null; created_at: string }
interface PersonRow { user_id: string; full_name: string | null; email: string | null }

async function fetchGrants(): Promise<GrantRow[]> {
  const { data, error } = await supabase
    .from("call_access_grants")
    .select("user_id, note, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Staff the grant can be offered to: everyone holding a staff role (user_roles), named via
// profiles. Small set (~15 rows), fetched only when an admin opens the panel.
async function fetchStaff(): Promise<PersonRow[]> {
  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role", ["manager", "va_manager", "recruiter", "va"]);
  if (roleError) throw new Error(roleError.message);
  const ids = [...new Set((roleRows ?? []).map((r) => r.user_id))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
}

// Names for existing grantees — fetched by the grant ids themselves, so a grantee who no
// longer holds a staff role still shows a name instead of a bare uuid.
async function fetchNames(ids: string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.user_id, p]));
}

export function CallAccessManager() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const [busy, setBusy] = useState(false);

  const grants = useQuery({ queryKey: ["call-access-grants"], queryFn: fetchGrants, staleTime: 60_000, enabled: open });
  const staff = useQuery({ queryKey: ["call-access-staff"], queryFn: fetchStaff, staleTime: 5 * 60_000, enabled: open });
  const grantIds = (grants.data ?? []).map((g) => g.user_id);
  const names = useQuery({
    queryKey: ["call-access-names", grantIds.sort().join(",")],
    queryFn: () => fetchNames(grantIds),
    enabled: open && grants.isSuccess,
  });

  const granted = new Set(grantIds);
  const candidates = (staff.data ?? []).filter((p) => !granted.has(p.user_id));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["call-access-grants"] });
    await qc.invalidateQueries({ queryKey: ["can-view-sold-calls"] });
  };

  const grant = async () => {
    const person = candidates.find((p) => p.user_id === pickedId);
    if (!person) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("call_access_grants").insert({
        user_id: person.user_id,
        note: `${person.full_name ?? person.email ?? person.user_id} — granted from Sold Calls`,
        granted_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      toast.success(`${person.full_name ?? "Granted"} can now see agent calls`);
      setPickedId("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (g: GrantRow, label: string) => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("call_access_grants")
        .delete()
        .eq("user_id", g.user_id);
      if (error) throw new Error(error.message);
      toast.success(`${label} no longer sees agent calls`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-md border border-border bg-card/50 px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ShieldCheck className="h-4 w-4 text-amber-500" />
        Who can see agent calls
        <span className="ml-auto text-xs text-muted-foreground">{open ? "Hide" : "Manage"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Admins always see everything. A grant below opens sold calls, booking packets (SSN/bank),
            call audio, coaching, call training and the Ayro book — the database enforces it everywhere at once.
          </p>

          {grants.isLoading && <p className="text-xs text-muted-foreground">Loading grants…</p>}
          {grants.isError && <p className="text-xs text-amber-500">Couldn’t load grants. Reopen to retry.</p>}

          <ul className="space-y-1">
            {(grants.data ?? []).map((g) => {
              const p = names.data?.get(g.user_id);
              const label = p?.full_name ?? p?.email ?? g.user_id;
              return (
                <li key={g.user_id} className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5 text-sm">
                  <span className="font-medium">{label}</span>
                  {g.note && <span className="truncate text-xs text-muted-foreground">{g.note}</span>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6"
                    aria-label={`Revoke agent-call access for ${label}`}
                    disabled={busy}
                    onClick={() => revoke(g, String(label))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2">
            <select
              aria-label="Staff member to grant agent-call access"
              className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm"
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
            >
              <option value="">Add a staff member…</option>
              {candidates.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name ?? p.email ?? p.user_id}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!pickedId || busy} onClick={grant}>
              Grant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
