import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useRolePreview } from "@/hooks/useRolePreview";
import { ProductionDemoContext } from "@/hooks/useDemoNumberFields";
import { isSamEmail } from "@/lib/samOnly";
import { isWorkingAgentRow, type AgentIdentity } from "@/lib/agentIdentity";
import { isDemoMode, subscribeDemoMode } from "@/lib/demoMode";
import { suppressDealCelebrations } from "@/lib/dealCelebrations";
import { demoNumberValues, EMPTY_PRODUCTION_DEMO, ProductionDemoStore, type DemoNumberEdit, type DemoNumberScope, type DemoSaveResult, type ProductionDemoSnapshot } from "@/lib/productionDemo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const JONTAY_AGENT_ID = "95759777-1432-4210-8e9b-f174d79685a2";
const subscribeToNothing = () => () => undefined;
const emptySnapshot = () => EMPTY_PRODUCTION_DEMO;
const EditorContext = createContext<{ open: (trigger: HTMLButtonElement) => void; active: boolean; hasFields: boolean } | null>(null);

interface DemoAccess {
  user: { id: string; email?: string | null } | null;
  isAdmin: boolean;
  isLoading: boolean;
  isPreviewing: boolean;
  identity?: AgentIdentity;
  identityUserId: string | null;
  identityLoading: boolean;
  identityError: boolean;
  masked: boolean;
}

/** Display capability only. Real auth and existing RLS still determine every underlying read. */
export function canEditProductionDemo(access: DemoAccess): boolean {
  if (!access.user || access.isLoading || access.isPreviewing) return false;
  if (access.isAdmin && isSamEmail(access.user.email)) return true;
  if (access.identityLoading || access.identityError || access.identityUserId !== access.user.id || access.identity?.status !== "resolved") return false;
  const identity = access.identity;
  if (!isWorkingAgentRow(identity.row)) return false;
  if (identity.agentId !== JONTAY_AGENT_ID && identity.mergedFromAgentId !== JONTAY_AGENT_ID) return false;
  // Global anonymization masks the server name but preserves the canonical identity IDs.
  return access.masked || identity.row.display_name?.trim().replace(/\s+/g, " ").toLowerCase() === "jontay taylor";
}

export interface ProductionDemoEditorProps {
  scopes: readonly DemoNumberScope[];
  overrides: ProductionDemoSnapshot["overrides"];
  onSave: (edits: readonly DemoNumberEdit[]) => DemoSaveResult;
  onReset: () => void;
  onClose: () => void;
  restoreFocusTo?: HTMLButtonElement | null;
  resetLabel?: string;
}

/** Pure editor presentation: local numeric props/callbacks, with no authentication or data client. */
export function ProductionDemoEditor({ scopes, overrides, onSave, onReset, onClose, restoreFocusTo, resetLabel = "Restore live figures" }: ProductionDemoEditorProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idPrefix = useId();
  const fieldCount = scopes.reduce((count, scope) => count + scope.fields.length, 0);
  const needle = search.trim().toLowerCase();
  const editId = (scopeKey: string, fieldKey: string) => JSON.stringify([scopeKey, fieldKey]);
  const submit = () => {
    const edits = Object.entries(draft).map(([id, value]) => {
      const [scopeKey, key] = JSON.parse(id) as [string, string];
      return { scopeKey, key, value };
    });
    const result = onSave(edits);
    if (result.ok === false) { setError(result.error); return; }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl" onCloseAutoFocus={(event) => { if (restoreFocusTo?.isConnected) { event.preventDefault(); restoreFocusTo.focus(); } }}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-2xl font-black italic uppercase">Demo figures</DialogTitle>
          <DialogDescription className="text-base">
            Change the figures shown for this account in this browser tab. Production totals scale their existing breakdown. These edits do not change production records.
          </DialogDescription>
          {scopes.some(scope => scope.fields.some(field => field.allowUnknown)) && <p className="text-sm text-muted-foreground">Optional issued-and-paid fields start blank. Placement uses the displayed cohort policy count as its demonstration submission denominator. Clear an optional field to leave it unknown.</p>}
        </DialogHeader>
        <form noValidate className="space-y-5" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {fieldCount > 8 && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-search`}>Find a figure</Label>
              <Input id={`${idPrefix}-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="h-11" placeholder="Search production, policies, goals…" />
            </div>
          )}
          {fieldCount === 0 && <p className="text-base text-muted-foreground">No editable production figures are currently visible on this page.</p>}
          <div className="space-y-3">
            {scopes.map((scope, scopeIndex) => {
              const visible = scope.fields.filter((field) => !needle || `${scope.label} ${field.label}`.toLowerCase().includes(needle));
              if (!visible.length) return null;
              const rendered = demoNumberValues(scope.scopeKey, scope.fields, overrides).values;
              return (
                <details key={scope.scopeKey} open={Boolean(needle) || fieldCount <= 12 || scopeIndex === 0} className="rounded-lg border border-border bg-card p-3 sm:p-4">
                  <summary className="min-h-11 cursor-pointer text-base font-semibold leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{scope.label} <span className="font-normal text-muted-foreground">({visible.length})</span></summary>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {visible.map((field) => {
                      const id = editId(scope.scopeKey, field.key);
                      const inputId = `${idPrefix}-${encodeURIComponent(id)}`;
                      return (
                        <div key={field.key} className="min-w-0 space-y-2">
                          <Label htmlFor={inputId}>{field.label}{field.kind === "money" ? " ($)" : field.kind === "percent" ? " (%)" : ""}</Label>
                          <Input
                            id={inputId}
                            type="number"
                            inputMode={field.kind === "count" ? "numeric" : "decimal"}
                            min={Math.max(0, field.min ?? 0)}
                            max={field.max ?? (field.kind === "percent" ? 100 : undefined)}
                            step={field.kind === "count" ? 1 : field.kind === "money" ? "0.01" : "any"}
                            value={draft[id] ?? (rendered[field.key] === undefined ? "" : String(rendered[field.key]))}
                            placeholder={field.allowUnknown ? "Unknown" : undefined}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDraft((previous) => {
                                const next = { ...previous };
                                if (value === (rendered[field.key] === undefined ? "" : String(rendered[field.key]))) delete next[id];
                                else next[id] = value;
                                return next;
                              });
                              setError(null);
                            }}
                            className="h-11 text-base tabular-nums"
                          />
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
          {needle && !scopes.some((scope) => scope.fields.some((field) => `${scope.label} ${field.label}`.toLowerCase().includes(needle))) && <p className="text-base text-muted-foreground">No figures match this search.</p>}
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { onReset(); onClose(); }}>{resetLabel}</Button>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="min-h-11" disabled={Object.keys(draft).length === 0}>Save demo figures</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductionDemoProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  const identity = useAgentIdentity();
  const masked = useSyncExternalStore(subscribeDemoMode, isDemoMode, isDemoMode);
  const allowed = canEditProductionDemo({ user, isAdmin, isLoading, isPreviewing, identity: identity.identity, identityUserId: identity.userId, identityLoading: identity.isLoading, identityError: identity.isError, masked });
  const userId = user?.id ?? null;
  const store = useMemo(() => allowed && userId ? new ProductionDemoStore(userId) : null, [allowed, userId]);
  const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeToNothing, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const [editorOwner, setEditorOwner] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => store?.retain(), [store]);
  useEffect(() => { setEditorOwner(null); }, [store]);
  useLayoutEffect(() => {
    if (store && snapshot.hasOverrides) return suppressDealCelebrations();
  }, [store, snapshot.hasOverrides]);

  const controls = store ? {
    open: (button: HTMLButtonElement) => { trigger.current = button; setEditorOwner(store.ownerId); },
    active: snapshot.hasOverrides,
    hasFields: snapshot.scopes.length > 0,
  } : null;

  return (
    <ProductionDemoContext.Provider value={store}>
      <EditorContext.Provider value={controls}>
        {children}
        {store && snapshot.hasOverrides && (
          <button type="button" onClick={(event) => controls?.open(event.currentTarget)} aria-label="Demo figures active. Edit or restore live figures" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-3 z-40 min-h-11 rounded-lg border border-primary/40 bg-card px-3 text-sm font-semibold text-primary shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:hidden">Demo figures</button>
        )}
        {store && editorOwner === store.ownerId && (
          <ProductionDemoEditor
            scopes={snapshot.scopes}
            overrides={snapshot.overrides}
            onSave={store.save}
            onReset={store.resetAll}
            onClose={() => setEditorOwner(null)}
            restoreFocusTo={trigger.current}
            resetLabel={masked ? "Restore masked figures" : "Restore live figures"}
          />
        )}
      </EditorContext.Provider>
    </ProductionDemoContext.Provider>
  );
}

/** Shared desktop/mobile pencil. Hidden for every account outside the exact display capability. */
export function DemoNumberEditorButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const controls = useContext(EditorContext);
  if (!controls) return null;
  return (
    <Button type="button" variant="ghost" size={compact || !controls.active ? "icon" : "default"} aria-label="Edit demo figures" aria-pressed={controls.active} title={controls.hasFields || controls.active ? "Edit demonstration figures" : "No editable production figures on this page"} disabled={!controls.hasFields && !controls.active} onClick={(event) => controls.open(event.currentTarget)} className={cn("h-11 min-w-11 gap-2", controls.active ? "text-primary" : "text-muted-foreground", className)}>
      <Pencil className="h-5 w-5" aria-hidden="true" />
      {controls.active && !compact && <span className="text-sm font-semibold">Demo figures</span>}
    </Button>
  );
}
