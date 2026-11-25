import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Copy, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import "./awards.css";

type CopyKind = "caption" | "stats";

/** Hide the previous account's selected record during the account-change render. */
export function useOwnedAwardSelection<T>(ownerId: string | null | undefined) {
  const [selection, setSelection] = useState<{ ownerId: string; value: T } | null>(null);
  const select = useCallback((value: T | null) => setSelection(ownerId && value !== null ? { ownerId, value } : null), [ownerId]);
  useEffect(() => { setSelection(null); }, [ownerId]);
  return [selection && selection.ownerId === ownerId ? selection.value : null, select] as const;
}

/** Local text tools only. Copying never saves an award or sends a post. */
export function AwardCopyActions({ caption, summary, showText = false }: {
  caption: string;
  summary: string;
  showText?: boolean;
}) {
  const [draftCaption, setDraftCaption] = useState(caption);
  const [kind, setKind] = useState<CopyKind>("caption");
  const [pending, setPending] = useState<CopyKind | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "fallback">("idle");
  const request = useRef(0);
  const text = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    request.current += 1;
    setDraftCaption(caption);
    setKind("caption");
    setPending(null);
    setManualOpen(false);
    setStatus("idle");
    return () => { request.current += 1; };
  }, [caption, summary]);

  useEffect(() => {
    if (status !== "fallback") return;
    text.current?.focus();
    text.current?.select();
  }, [status, kind]);

  const copy = async (nextKind: CopyKind) => {
    const attempt = ++request.current;
    setKind(nextKind);
    setPending(nextKind);
    setStatus("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(nextKind === "caption" ? draftCaption : summary);
      if (attempt === request.current) setStatus("copied");
    } catch {
      if (attempt === request.current) { setManualOpen(true); setStatus("fallback"); }
    } finally {
      if (attempt === request.current) setPending(null);
    }
  };

  return (
    <div className="award-copy">
      <div className="award-copy__actions">
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void copy("caption")}>
          {status === "copied" && kind === "caption" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {pending === "caption" ? "Copying…" : "Copy caption"}
        </Button>
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void copy("stats")}>
          {status === "copied" && kind === "stats" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {pending === "stats" ? "Copying…" : "Copy stats"}
        </Button>
      </div>
      {status === "copied" && <p role="status" className="award-copy__status">{kind === "caption" ? "Caption copied." : "Stats copied."}</p>}
      {status === "fallback" && <p role="status" className="award-copy__status award-copy__status--fallback">Clipboard unavailable. Select the text below and copy it.</p>}
      {(showText || manualOpen) && (
        <div className="award-copy__manual">
          <div className="award-copy__tabs" role="group" aria-label="Text to copy">
            <Button type="button" disabled={pending !== null} variant={kind === "caption" ? "secondary" : "ghost"} aria-pressed={kind === "caption"} onClick={() => { setKind("caption"); setStatus("idle"); }}>Caption</Button>
            <Button type="button" disabled={pending !== null} variant={kind === "stats" ? "secondary" : "ghost"} aria-pressed={kind === "stats"} onClick={() => { setKind("stats"); setStatus("idle"); }}>Stats</Button>
          </div>
          <label htmlFor={id}>{kind === "caption" ? "Caption text · edit before copying" : "Award stats · recorded facts"}</label>
          <Textarea
            id={id}
            ref={text}
            rows={6}
            value={kind === "caption" ? draftCaption : summary}
            readOnly={kind === "stats" || pending !== null}
            onChange={(event) => { if (kind === "caption") { setDraftCaption(event.target.value); setStatus("idle"); } }}
            className="award-copy__text"
          />
          <Button type="button" variant="ghost" onClick={() => { text.current?.focus(); text.current?.select(); }}>
            <TextCursorInput aria-hidden="true" /> Select text
          </Button>
        </div>
      )}
    </div>
  );
}
