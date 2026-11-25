import { useId, type ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LeadSearchField({ value, onChange, label, placeholder, testId }: {
  value: string; onChange: (value: string) => void; label: string; placeholder: string; testId?: string;
}) {
  const id = useId();
  return <div className="relative min-w-0 flex-1">
    <label htmlFor={id} className="sr-only">{label}</label>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
      data-testid={testId} className="h-12 rounded-xl bg-background pl-10 pr-12 text-base [&::-webkit-search-cancel-button]:appearance-none" />
    {value && <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-0.5 h-11 w-11 rounded-lg" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange("")}><X className="h-4 w-4" /></Button>}
  </div>;
}

export function LeadFilterSelect({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode;
}) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</label>
    <div className="relative">
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-10 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  </div>;
}

export function LeadPagination({ page, pageSize, total, onPageChange, label = "Lead results" }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void; label?: string;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label={`${label} pages`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
    <p className="text-sm text-muted-foreground" aria-live="polite">Showing <span className="font-semibold tabular-nums text-foreground">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)}</span> of {total.toLocaleString()}</p>
    {pageCount > 1 && <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className="h-11" disabled={page === 0} onClick={() => onPageChange(page - 1)} aria-label={`Previous ${label.toLowerCase()} page`}>Previous</Button>
      <span className="px-1 text-sm tabular-nums text-muted-foreground">{page + 1} / {pageCount}</span>
      <Button type="button" variant="outline" className="h-11" disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)} aria-label={`Next ${label.toLowerCase()} page`}>Next</Button>
    </div>}
  </nav>;
}
