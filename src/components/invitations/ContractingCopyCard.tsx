import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/phone";
import { contractingBlock, type ContractingInfo } from "@/lib/inviteContractingInfo";

const FIELDS: Array<{ key: keyof ContractingInfo; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "npn", label: "NPN" },
];

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("clipboard blocked", err);
    toast.error("Your browser blocked copying. Select the text and copy it by hand.");
    return false;
  }
}

/**
 * The contracting fields, one per row, each with its own Copy button, so the team
 * can fill a carrier or SureLC page field by field without retyping. Values are
 * selectable text too. Phone copies as (256) 975-6155, which carrier forms accept.
 *
 * Under sm the label sits over the value and the value wraps (council finding 29):
 * a phone or an email is never cut to "(256…" on a 390px screen, because the person
 * must be able to read what they are about to copy.
 *
 * Every Copy pops once the clipboard has the value (2026-10-28 colour layer); a blocked
 * clipboard keeps its message above and stays silent.
 */
export function ContractingCopyCard({ info, className }: { info: ContractingInfo; className?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const filled = FIELDS.filter((f) => info[f.key]);

  const copy = async (key: string, label: string, text: string) => {
    if (!(await writeClipboard(text))) return;
    playSoundEffect("pop");
    setCopied(key);
    toast.success(`${label} copied.`);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <dl className="divide-y divide-border">
        {FIELDS.map((f) => {
          const raw = info[f.key];
          const value = f.key === "phone" && raw ? formatPhoneDisplay(raw) || raw : raw;
          return (
            <div
              key={f.key}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
            >
              <dt className="col-start-1 row-start-1 text-sm text-muted-foreground">{f.label}</dt>
              <dd
                className={cn(
                  "col-start-1 row-start-2 min-w-0 select-all break-words text-base sm:col-start-2 sm:row-start-1",
                  value ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {value || "Not given"}
              </dd>
              {value && (
                <Button
                  type="button"
                  variant="outline"
                  className="col-start-2 row-span-2 row-start-1 h-11 shrink-0 gap-1.5 px-3 sm:col-start-3 sm:row-span-1"
                  onClick={() => void copy(f.key, f.label, value)}
                  aria-label={`Copy ${f.key === "npn" ? f.label : f.label.toLowerCase()}`}
                >
                  {copied === f.key ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === f.key ? "Copied" : "Copy"}
                </Button>
              )}
            </div>
          );
        })}
      </dl>
      {filled.length > 1 && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full gap-1.5"
            onClick={() => void copy("__all__", "All contracting info", contractingBlock(info))}
          >
            {copied === "__all__" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "__all__" ? "Copied all" : "Copy all"}
          </Button>
        </div>
      )}
    </div>
  );
}
