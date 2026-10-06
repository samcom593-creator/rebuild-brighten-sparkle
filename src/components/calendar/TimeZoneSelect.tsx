import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMMON_ZONES, isValidTimeZone } from "@/lib/calendarTime";

/**
 * IANA zone picker. A stored zone outside the common list (e.g. one Calendly
 * recorded) is kept as an option rather than silently replaced.
 */
export function TimeZoneSelect({
  id,
  value,
  onChange,
  ariaLabel = "Time zone",
  className,
}: {
  id?: string;
  value: string;
  onChange: (tz: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const extra = isValidTimeZone(value) && !COMMON_ZONES.some((z) => z.value === value) ? [{ value, label: value }] : [];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[...extra, ...COMMON_ZONES].map((z) => (
          <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
