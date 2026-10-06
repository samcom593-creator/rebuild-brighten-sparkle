import { suggestEmailCorrection } from "@/lib/emailValidation";

/** Shows "Did you mean …?" under an email field. One tap applies it; ignoring it keeps what was typed. */
export function EmailTypoHint({ value, onAccept }: { value: string; onAccept: (next: string) => void }) {
  const suggestion = suggestEmailCorrection(value ?? "");
  if (!suggestion) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground" role="status">
      Did you mean{" "}
      <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => onAccept(suggestion)}>
        {suggestion}
      </button>
      ?
    </p>
  );
}
