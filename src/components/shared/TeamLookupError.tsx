import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useMyDownline } from "@/hooks/useMyDownline";

/**
 * A failed team lookup used to read as "no team": useMyDownline returned [] on error, so every
 * screen built on it showed empty lists and zero counts. The hook now reports the failure
 * (GROW-CRAFT-3); this is the one notice those screens show, so an empty state never stands in
 * for "we could not load it". It reads the same cached query, so it costs no extra request.
 */
export function TeamLookupError({ className }: { className?: string }) {
  const downline = useMyDownline();
  if (!downline.isError) return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{"Couldn't load your team"}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>Lists and counts on this page may be missing people until it loads.</span>
        <Button size="sm" variant="outline" onClick={() => void downline.refetch()} disabled={downline.isFetching}>
          {downline.isFetching ? "Trying again" : "Try again"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
