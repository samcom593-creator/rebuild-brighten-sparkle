import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
 */
export function ContractingCopyCard({ info, className }: { info: ContractingInfo; className?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const filled = FIELDS.filter((f) => info[f.key]);

  const copy = async (key: string, label: string, text: string) => {
    if (!(await writeClipboard(text))) return;
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
            <div key={f.key} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <dt className="w-[5.5rem] shrink-0 text-sm text-muted-foreground">{f.label}</dt>
              <dd className={cn("min-w-0 flex-1 select-all truncate text-base", value ? "text-foreground" : "text-muted-foreground")} title={value || undefined}>
                {value || "Not given"}
              </dd>
              {value && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-1.5 px-3"
                  onClick={() => void copy(f.key, f.label, value)}
                  aria-label={`Copy ${f.label.toLowerCase()}`}
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
