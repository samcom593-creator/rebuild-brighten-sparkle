/**
 * An agent's own documents — upload a file, or link one that already lives in
 * Drive/Dropbox.
 *
 * There was no agent document store before this: storage had deal evidence,
 * call recordings and public avatar/award buckets, but nowhere for the
 * paperwork an insurance agent actually has to hand in.
 *
 * Both shapes are one row type (storage_path xor external_url) so the reviewer
 * works ONE list instead of two. The bucket is private and every read is a
 * short-lived signed URL — these are IDs and voided checks, so there is no
 * public link to leak or forward.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Link2, Loader2, Upload, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const BUCKET = "agent-documents";

const KINDS = [
  { value: "license", label: "License" },
  { value: "eo_certificate", label: "E&O certificate" },
  { value: "voided_check", label: "Voided check" },
  { value: "id", label: "ID" },
  { value: "contracting", label: "Contracting form" },
  { value: "other", label: "Other" },
] as const;

const STATUS_TONE: Record<string, string> = {
  submitted: "secondary",
  approved: "default",
  rejected: "destructive",
  needs_replacement: "destructive",
};

interface DocRow {
  id: string;
  kind: string;
  title: string | null;
  storage_path: string | null;
  external_url: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
}

export function AgentDocuments({ agentId }: { agentId: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>("license");
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["agent-documents", agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_documents" as never)
        .select("id,kind,title,storage_path,external_url,status,review_note,created_at")
        .eq("agent_id", agentId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocRow[];
    },
  });

  const reset = useCallback(() => {
    setTitle("");
    setLinkUrl("");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const addLink = useMutation({
    mutationFn: async () => {
      if (!agentId) throw new Error("No agent record on your account yet.");
      const url = linkUrl.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("Paste a full link starting with https://");
      const { error } = await supabase.from("agent_documents" as never).insert({
        agent_id: agentId, kind, title: title.trim() || null, external_url: url,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Link added"); reset(); qc.invalidateQueries({ queryKey: ["agent-documents", agentId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useCallback(async (file: File) => {
    if (!agentId) { toast.error("No agent record on your account yet."); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error("That file is over 15MB. Send a link instead."); return; }
    setBusy(true);
    try {
      // Path contract is <agent_id>/<file>. The storage policy compares that
      // first segment to the caller's own agent id, so the path is the
      // permission — a crafted path cannot reach another agent's folder.
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${agentId}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from("agent_documents" as never).insert({
        agent_id: agentId, kind, title: title.trim() || file.name, storage_path: path,
      } as never);
      // The row is the record of truth. If it fails the object is orphaned, so
      // remove it rather than leaving a file nothing points at.
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw rowErr;
      }
      toast.success("Uploaded");
      reset();
      qc.invalidateQueries({ queryKey: ["agent-documents", agentId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [agentId, kind, title, qc, reset]);

  const openDoc = useCallback(async (doc: DocRow) => {
    if (doc.external_url) { window.open(doc.external_url, "_blank", "noopener,noreferrer"); return; }
    if (!doc.storage_path) return;
    // Signed, short-lived. The bucket is private on purpose.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
    if (error || !data?.signedUrl) { toast.error("Could not open that file"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, []);

  const remove = useMutation({
    mutationFn: async (doc: DocRow) => {
      const { error } = await supabase.from("agent_documents" as never).delete().eq("id", doc.id);
      if (error) throw error;
      if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["agent-documents", agentId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const kindLabel = useMemo(
    () => Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<string, string>,
    [],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> My documents
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          License, E&amp;O, voided check, ID, contracting forms. Upload a file or paste a link.
          Only you and your upline can see these.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="doc-kind">Type</Label>
            <select
              id="doc-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="doc-title">Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="doc-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. TX license 2026" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy || !agentId} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload a file
          </Button>
          <span className="text-xs text-muted-foreground">or</span>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="h-10 max-w-xs"
          />
          <Button
            variant="outline"
            onClick={() => addLink.mutate()}
            disabled={addLink.isPending || !linkUrl.trim() || !agentId}
            className="gap-2"
          >
            <Link2 className="h-4 w-4" /> Add link
          </Button>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-md bg-muted/30" />
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
          ) : (
            docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{d.title || kindLabel[d.kind] || d.kind}</span>
                    <Badge variant={(STATUS_TONE[d.status] ?? "secondary") as "default" | "secondary" | "destructive"}>
                      {d.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {kindLabel[d.kind] ?? d.kind} · {new Date(d.created_at).toLocaleDateString()}
                    {d.review_note ? ` · ${d.review_note}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void openDoc(d)} aria-label="Open document">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {d.status === "submitted" && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(d)} aria-label="Remove document">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
