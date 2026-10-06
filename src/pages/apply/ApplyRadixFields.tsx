import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The only radix consumers on /apply (PL-WIB-APPLY-RADIX, 2026-10-06).
// Apply.tsx loads this module lazily so the 163 KB vendor-radix chunk is
// fetched after step 1's heading paints, not in front of it. Keep every
// @radix-ui import on the apply flow behind this file; ApplyFieldFallbacks
// in Apply.tsx renders same-size placeholders while it loads.

export interface ApplySelectOption {
  value: string;
  label: ReactNode;
}

export interface ApplySelectProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: readonly ApplySelectOption[];
  id?: string;
  ariaLabel?: string;
}

export function ApplySelect({ value, onValueChange, placeholder, options, id, ariaLabel }: ApplySelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="bg-input">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { Checkbox as ApplyCheckbox };
