import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * MP-350: an editable client section.
 *
 * ClientDetail rendered eight tabs and wrote to agentlink_clients from NONE of
 * them — only Schedule and Notes saved, and those go to a separate overrides
 * table. Contact, Needs Analysis, Financials and Policies displayed columns the
 * table had stored all along with no way to correct a single one. Sam: "still
 * can't edit it all inside the pipeline, every section should work."
 *
 * The server owns the rules. fn_client_pipeline_update takes a jsonb patch
 * against a strict column allowlist, so identity and ownership columns are not
 * writable, and it REJECTS an unknown key outright rather than half-applying —
 * a field the user believed they saved silently vanishing is the failure this
 * codebase keeps finding.
 *
 * Only changed fields are sent, so opening Edit and pressing Save without
 * touching anything is a no-op instead of a rewrite of every column.
 */
export type ClientField = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "email" | "tel";
  hint?: string;
};

export function EditableClientSection({
  clientId,
  fields,
  values,
  onSaved,
}: {
  clientId: string;
  fields: ClientField[];
  values: Record<string, unknown>;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const asInput = (value: unknown, type?: string) => {
    if (value === null || value === undefined) return "";
    if (type === "date") return String(value).slice(0, 10);
    return String(value);
  };

  const start = () => {
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = asInput(values[f.key], f.type);
    setDraft(next);
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      // Send ONLY what changed. A blanket write would stamp every column on
      // every save and make the activity log useless for telling what a person
      // actually touched.
      const patch: Record<string, string> = {};
      for (const f of fields) {
        const before = asInput(values[f.key], f.type);
        const after = (draft[f.key] ?? "").trim();
        if (after !== before) patch[f.key] = after;
      }
      if (Object.keys(patch).length === 0) return { count: 0 };
      const { data, error } = await supabase.rpc("fn_client_pipeline_update" as never, {
        p_client_id: clientId,
        p_patch: patch,
      } as never);
      if (error) throw error;
      return data as unknown as { count: number };
    },
    onSuccess: async (result) => {
      if (result?.count === 0) {
        toast.info("Nothing changed");
      } else {
        toast.success(`Saved ${result?.count ?? 0} field${result?.count === 1 ? "" : "s"}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["client-detail", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["client-pipeline-activity", clientId] });
      setEditing(false);
      onSaved?.();
    },
    // The server's message is the useful one — "Not editable here: agent_id"
    // and "Client not found or access denied" mean different things.
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  if (!editing) {
    return (
      <>
        <dl className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key}>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {asInput(values[f.key], f.type) || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          ))}
        </dl>
        <Button className="mt-4" size="sm" variant="outline" onClick={start}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label className="text-xs" htmlFor={`client-${f.key}`}>{f.label}</Label>
            <Input
              id={`client-${f.key}`}
              type={f.type ?? "text"}
              value={draft[f.key] ?? ""}
              onChange={(event) => setDraft((d) => ({ ...d, [f.key]: event.target.value }))}
            />
            {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1.5 h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setEditing(false)}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
        </Button>
      </div>
    </>
  );
}
