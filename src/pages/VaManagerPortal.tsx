import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Ban, ShieldCheck, Loader2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * /va-team — the VA Manager (Milver) portal.
 * Create VA logins, monitor sign-in activity, and disable/restore access.
 * All writes go through the create-va-account / set-va-account edge functions,
 * which authenticate the caller from their JWT and scope every action to VAs
 * the caller manages (profiles.managed_by). list_my_vas() returns only own VAs.
 */
export default function VaManagerPortal() {
  usePageTitle("VA Team · APEX");
  const { isAdmin, isVaManager } = useAuth();
  const askConfirm = useConfirm();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    data: vas = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["my-vas"],
    queryFn: async (): Promise<VaRow[]> => {
      const { data, error } = await (
        supabase.rpc as unknown as (fn: string) => Promise<{ data: VaRow[] | null; error: unknown }>
      )("list_my_vas");
      if (error) throw error;
      return (data ?? []) as VaRow[];
    },
    enabled: isAdmin || isVaManager,
    staleTime: 30_000,
  });

  async function handleCreate() {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    setCreating(true);
    setCreated(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-va-account", {
        body: {
          full_name: name.trim(),
          email: email.trim().toLowerCase(),
          password: password.trim() || undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setCreated({ email: data.email, password: data.password });
      setName("");
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["my-vas"] });
      toast.success("VA account created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create VA.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleAccess(row: VaRow) {
    const action = row.disabled ? "enable" : "disable";
    const label = row.full_name || row.email || "this VA";
    const ok = await askConfirm({
      title: row.disabled ? `Re-enable ${label}?` : `Disable ${label}?`,
      description: row.disabled
        ? "They will be able to sign in again immediately."
        : "They will be signed out and blocked from logging in until you re-enable them.",
      confirmText: row.disabled ? "Enable" : "Disable",
      tone: row.disabled ? "primary" : "danger",
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      const { data, error } = await supabase.functions.invoke("set-va-account", {
        body: { va_user_id: row.user_id, action },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: ["my-vas"] });
      toast.success(row.disabled ? "Access restored." : "Access disabled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update access.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyCreds() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
      toast.success("Credentials copied.");
    } catch {
      toast.error("Clipboard blocked — copy them manually.");
    }
  }

  if (!isAdmin && !isVaManager) {
    return (
      <div className="p-8 text-center text-muted-foreground">You don't have access to the VA Team portal.</div>
    );
  }

  const activeCount = vas.filter((v) => !v.disabled).length;
  const disabledCount = vas.length - activeCount;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-cyan-400">
            <ShieldCheck className="h-3.5 w-3.5" /> VA Team · Portal
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <Users className="h-6 w-6 text-primary" /> Virtual Assistants
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create VA logins, monitor activity, and disable or restore access anytime.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreated(null);
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <UserPlus className="h-4 w-4" /> New VA
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">{vas.length} total</Badge>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
          {activeCount} active
        </Badge>
        {disabledCount > 0 && (
          <Badge variant="outline" className="border-rose-500/30 text-rose-400">
            {disabledCount} disabled
          </Badge>
        )}
      </div>

      <GlassCard className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="p-8 text-center text-sm text-rose-400">
            Couldn't load VAs. {error instanceof Error ? error.message : ""}
          </p>
        ) : vas.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No VAs yet. Click <span className="font-medium text-foreground">New VA</span> to create the first account.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                  <th className="h-10 px-4 font-medium">Name</th>
                  <th className="h-10 px-4 font-medium">Email</th>
                  <th className="h-10 px-4 font-medium">Created</th>
                  <th className="h-10 px-4 font-medium">Last sign-in</th>
                  <th className="h-10 px-4 font-medium">Status</th>
                  <th className="h-10 px-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vas.map((v) => (
                  <tr key={v.user_id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{v.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.email || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {v.last_sign_in_at ? new Date(v.last_sign_in_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      {v.disabled ? (
                        <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-300">Disabled</Badge>
                      ) : (
                        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">Active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={v.disabled ? "outline" : "ghost"}
                        size="sm"
                        disabled={busyId === v.user_id}
                        onClick={() => toggleAccess(v)}
                        className={
                          v.disabled
                            ? "gap-1.5"
                            : "gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        }
                      >
                        {busyId === v.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : v.disabled ? (
                          <ShieldCheck className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                        {v.disabled ? "Enable" : "Disable"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a VA account</DialogTitle>
            <DialogDescription>
              Your VA signs in at the login page with the email and password below.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-400">Account created. Share these credentials with your VA:</p>
              <div className="space-y-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
                <div>Email: {created.email}</div>
                <div>Password: {created.password}</div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={copyCreds}>
                <Copy className="h-4 w-4" /> Copy credentials
              </Button>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setCreated(null);
                    setCreateOpen(false);
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="va-name">Full name</Label>
                <Input id="va-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="va-email">Email</Label>
                <Input
                  id="va-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="va-pass">
                  Password <span className="text-muted-foreground">(optional — defaults to 123456)</span>
                </Label>
                <Input
                  id="va-pass"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank for 123456"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Create VA
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
